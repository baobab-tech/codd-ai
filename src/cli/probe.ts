/**
 * Probe every org URL: reachability, bot blocking, robots.txt AI rules, and platform fingerprint via API.
 * Writes probes, sources, org_sources, observations, and open_items.
 *
 *   pnpm probe [--only id1,id2] [--limit n] [--concurrency 8]
 */
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { all, closeDb, db, observe, openItem, upsert } from "../db.js";
import { BROWSER_UA, type FetchResult, fetchText, json } from "../http.js";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const ONLY = arg("--only")?.split(",");
const LIMIT = Number(arg("--limit") ?? Infinity);
const CONCURRENCY = Number(arg("--concurrency") ?? 8);

// Directory URLs that are a front end for an API hosted elsewhere. Value is the URL to fingerprint instead.
const API_HOME: Record<string, string> = {
  "search.open.canada.ca": "https://open.canada.ca/data/",
  "open.toronto.ca": "https://ckan0.cf.opendata.inter.prod-toronto.ca/",
};

const AI_AGENTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "CCBot", "Google-Extended", "PerplexityBot", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot"];

interface Org {
  id: string;
  name_en: string;
  url: string | null;
  host: string | null;
  platform_label: string;
  relationship: string | null;
  dataset_count: number | null;
}

interface Detected {
  platform: string;
  base_url: string;
  count: number | null;
  scope?: Record<string, string>;
  scope_count?: number | null;
  version?: string | null;
  evidence: string;
}

const conn = await db();
const now = () => new Date().toISOString();
const probeRows: object[] = [];

function logProbe(check: string, r: FetchResult, result: unknown = null) {
  probeRows.push({ url: r.url, check, status: r.status, final_url: r.final_url, content_type: r.content_type, server: r.server, blocked: r.blocked, ms: r.ms, error: r.error, result, fetched_at: now() });
}

// Serialize requests per host, spaced by HOST_GAP_MS, so we never burst one server.
const HOST_GAP_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostChains = new Map<string, Promise<unknown>>();
function onHost<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostChains.get(host) ?? Promise.resolve();
  const run = () => sleep(HOST_GAP_MS).then(fn);
  const next = prev.then(run, run);
  hostChains.set(host, next.catch(() => {}));
  return next;
}
const get = (url: string, opts?: Parameters<typeof fetchText>[1]) => onHost(new URL(url).host, () => fetchText(url, opts));

// robots.txt, once per host.
const robotsCache = new Map<string, Promise<Record<string, unknown> | null>>();
function robots(origin: string) {
  if (!robotsCache.has(origin))
    robotsCache.set(
      origin,
      (async () => {
        const r = await get(`${origin}/robots.txt`, { accept: "text/plain" });
        const ok = r.status === 200 && !/<html/i.test(r.body.slice(0, 500));
        const facts = ok ? parseRobots(r.body) : { present: false, status: r.status, blocked: r.blocked };
        logProbe("robots", r, facts);
        return facts;
      })(),
    );
  return robotsCache.get(origin)!;
}

function parseRobots(txt: string) {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  const signals: string[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    const key = k.toLowerCase();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], disallow: [], allow: [] }));
      cur.agents.push(v);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "content-signal") signals.push(v);
    if (!cur) continue;
    if (key === "disallow" && v) cur.disallow.push(v);
    if (key === "allow" && v) cur.allow.push(v);
  }
  const groupFor = (agent: string) => groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));
  const blocksAll = (g?: (typeof groups)[number]) => !!g && g.disallow.includes("/") && !g.allow.includes("/");
  const star = groupFor("*");
  const named = AI_AGENTS.filter((a) => groupFor(a));
  return {
    present: true,
    star_disallow_all: blocksAll(star),
    star_disallows_api: !!star?.disallow.some((d) => /^\/(api|data\/api)/.test(d)),
    ai_agents_named: named,
    ai_agents_blocked: named.filter((a) => blocksAll(groupFor(a))),
    content_signal: signals,
    sitemap: /^\s*sitemap\s*:/im.test(txt),
  };
}

function htmlFacts(body: string, baseUrl: string) {
  const $ = cheerio.load(body);
  const links = $("a[href]").map((_, a) => $(a).attr("href")!).get();
  const ext = (re: RegExp) => links.filter((h) => re.test(h.split(/[?#]/)[0])).length;
  const gen = $('meta[name="generator"]').attr("content") ?? null;
  const text = body.slice(0, 300_000).toLowerCase();
  const hints = [
    /ckan|\/dataset\/|data-module=/.test(text) && "ckan",
    /hub\.arcgis\.com|arcgis hub|opendata\.arcgis|esri/.test(text) && "arcgis_hub",
    /socrata|tyler technologies|data\.json\?/.test(text) && "socrata",
    /opendatasoft|ods-/.test(text) && "opendatasoft",
    /dataverse/.test(text) && "dataverse",
    /dkan/.test(text) && "dkan",
    /figshare/.test(text) && "figshare",
    /geonetwork/.test(text) && "geonetwork",
    /drupal/.test((gen ?? "") + text.slice(0, 20000)) && "drupal",
    /wordpress|wp-content/.test(text) && "wordpress",
  ].filter(Boolean) as string[];
  return {
    title: $("title").first().text().trim().slice(0, 200) || null,
    generator: gen,
    hints,
    links: links.length,
    pdf_links: ext(/\.pdf$/i),
    tabular_links: ext(/\.(csv|xlsx?|json|geojson|zip|kml|kmz|shp|gpkg|parquet)$/i),
    base: baseUrl,
  };
}

// ---- platform fingerprints. Each returns a Detected or null. ----

async function tryCkan(origin: string, path: string): Promise<Detected | null> {
  const segs = path.split("/").filter(Boolean);
  const prefixes = [...new Set(["", segs[0] ? `/${segs[0]}` : "", "/data", "/recherche", "/ckan", "/catalogue", "/dataset"].filter((p) => p !== null))];
  for (const p of prefixes) {
    const r = await get(`${origin}${p}/api/3/action/package_search?rows=0`);
    const j = json(r);
    logProbe("ckan", r, j?.success ? { count: j.result?.count } : null);
    if (j?.success) {
      const base = `${origin}${p}`;
      const v = json(await get(`${base}/api/3/action/status_show`))?.result?.ckan_version ?? null;
      const det: Detected = { platform: "ckan", base_url: base, count: j.result.count, version: v, evidence: r.url };
      const org = path.match(/\/organization\/([^/?#]+)/)?.[1];
      if (org) {
        const s = await get(`${base}/api/3/action/package_search?rows=0&fq=organization:${org}`);
        const sj = json(s);
        logProbe("ckan", s, sj?.success ? { count: sj.result?.count } : null);
        det.scope = { ckan_fq: `organization:${org}` };
        det.scope_count = sj?.success ? sj.result.count : null;
      }
      return det;
    }
    if (r.blocked) return null;
  }
  return null;
}

async function tryHub(origin: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/search/v1/collections/dataset/items?limit=1`);
  const j = json(r);
  logProbe("arcgis_hub", r, j ? { count: j.numberMatched } : null);
  if (j && typeof j.numberMatched === "number") return { platform: "arcgis_hub", base_url: origin, count: j.numberMatched, evidence: r.url };
  // Some Hub sites have a broken search API ("Site catalog is not configured correctly") but a working DCAT feed.
  if (r.status === 400 && /Site catalog/.test(r.body)) {
    const f = await get(`${origin}/api/feed/dcat-us/1.1.json`, { accept: "application/json", timeoutMs: 60_000 });
    const fj = json(f);
    logProbe("arcgis_hub_feed", f, fj ? { count: fj.dataset?.length } : null);
    if (Array.isArray(fj?.dataset)) return { platform: "arcgis_hub", base_url: origin, count: fj.dataset.length, version: "search API broken; dcat feed only", evidence: f.url };
  }
  return null;
}

async function trySocrata(origin: string, host: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/catalog/v1?domains=${host}&search_context=${host}&only=dataset&limit=1`);
  const j = json(r);
  logProbe("socrata", r, j ? { count: j.resultSetSize } : null);
  if (j && typeof j.resultSetSize === "number") return { platform: "socrata", base_url: origin, count: j.resultSetSize, evidence: r.url };
  return null;
}

async function tryOds(origin: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/explore/v2.1/catalog/datasets?limit=1`);
  const j = json(r);
  logProbe("opendatasoft", r, j ? { count: j.total_count } : null);
  if (j && typeof j.total_count === "number") return { platform: "opendatasoft", base_url: origin, count: j.total_count, evidence: r.url };
  return null;
}

async function tryDataverse(origin: string, path: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/search?q=*&type=dataset&per_page=1`);
  const j = json(r);
  logProbe("dataverse", r, j?.data ? { count: j.data.total_count } : null);
  if (j?.status === "OK") {
    const det: Detected = { platform: "dataverse", base_url: origin, count: j.data.total_count, evidence: r.url };
    const sub = path.match(/\/dataverse\/([^/?#]+)/)?.[1];
    if (sub) {
      const s = json(await get(`${origin}/api/search?q=*&type=dataset&per_page=1&subtree=${sub}`));
      det.scope = { dataverse_subtree: sub };
      det.scope_count = s?.data?.total_count ?? null;
    }
    return det;
  }
  return null;
}

async function tryDcat(origin: string): Promise<Detected | null> {
  // DKAN and many CMSes expose a DCAT-US data.json. Body is capped, so count is a lower bound when large.
  const r = await get(`${origin}/data.json`, { accept: "application/json" });
  let count: number | null = null;
  try {
    const j = JSON.parse(r.body);
    count = Array.isArray(j?.dataset) ? j.dataset.length : null;
  } catch {
    const m = r.body.match(/"identifier"\s*:/g);
    count = r.status === 200 && /"dataset"\s*:\s*\[/.test(r.body) ? (m?.length ?? 0) : null;
  }
  logProbe("dcat", r, count !== null ? { count, truncated: r.body.length >= 2_000_000 } : null);
  return count !== null ? { platform: "dcat", base_url: `${origin}/data.json`, count, evidence: r.url } : null;
}

async function fingerprint(url: string, hints: string[], label: string, labelOnly = false): Promise<Detected | null> {
  const u = new URL(url);
  const { origin, pathname: path, host } = u;
  if (/(^|\.)figshare\.com$/.test(host)) return { platform: "figshare", base_url: "https://api.figshare.com/v2", count: null, evidence: "host" };
  const order = labelOnly ? [label] : [...new Set([label, ...hints, "ckan", "arcgis_hub", "socrata", "opendatasoft", "dataverse"])];
  for (const p of order) {
    const d =
      p === "ckan" ? await tryCkan(origin, path) :
      p === "arcgis_hub" ? await tryHub(origin) :
      p === "socrata" ? await trySocrata(origin, host) :
      p === "opendatasoft" ? await tryOds(origin) :
      p === "dataverse" ? await tryDataverse(origin, path) :
      null;
    if (d) return d;
  }
  return labelOnly ? null : tryDcat(origin);
}

// ---- per-org probe ----

const AUTO_KINDS = "('dead_link','blocker','needs_profiling','platform_mismatch','data_error')";

/** Re-probing re-derives an org's sources and auto items, so clear the previous ones first. */
async function resetOrg(org: Org) {
  await all(conn, `update open_items set status = 'stale', updated_at = now() where status = 'open' and kind in ${AUTO_KINDS} and (
      (subject_type = 'org' and subject_id = $id) or
      (subject_type = 'source' and subject_id in (select source_id from org_sources where org_id = $id)))`, { id: org.id });
  await all(conn, "delete from org_sources where org_id = $id", { id: org.id });
}

async function probeOrg(org: Org) {
  await resetOrg(org);
  if (!org.url) {
    await openItem(conn, { kind: "data_error", subject_type: "org", subject_id: org.id, key: "no_url", title: `${org.name_en}: no URL in directory` });
    return { id: org.id, outcome: "no_url" };
  }

  let root = await get(org.url);
  logProbe("root", root);
  let uaBlocked = false;
  let challengeCleared = false;
  if (root.blocked?.endsWith("_challenge")) {
    // Rate-based challenges usually clear after a pause.
    await sleep(10_000);
    const again = await get(org.url);
    logProbe("root_retry", again);
    if (again.status === 200 && !again.blocked) {
      challengeCleared = true;
      root = again;
    }
  }
  if (root.blocked) {
    const retry = await get(org.url, { ua: BROWSER_UA });
    logProbe("root_browser_ua", retry);
    if (!retry.blocked && retry.status === 200) {
      uaBlocked = true;
      root = retry;
    }
  }
  const finalUrl = root.final_url ?? org.url;
  const origin = new URL(finalUrl).origin;
  const rb = await robots(origin);
  await observe(conn, "org", org.id, "robots", rb, `${origin}/robots.txt`);

  const blockedHard = !!root.blocked && !uaBlocked;
  await observe(conn, "org", org.id, "access", { status: root.status, final_url: root.final_url, error: root.error, blocked: root.blocked, blocked_default_ua: uaBlocked, server: root.server, ms: root.ms, https: finalUrl.startsWith("https:") }, org.url);

  if (challengeCleared) await observe(conn, "org", org.id, "rate_challenge", { first: "challenge", after_pause: root.status }, org.url);
  if (root.error && /CERT|SIGNATURE|SSL|TLS/i.test(root.error))
    await openItem(conn, { kind: "blocker", subject_type: "org", subject_id: org.id, key: "tls", title: `${org.name_en}: TLS error (${root.error})`, detail: `${org.url}: strict HTTPS clients (Node, Python requests) fail; browsers may succeed via AIA fetching` });
  if (uaBlocked) await openItem(conn, { kind: "blocker", subject_type: "org", subject_id: org.id, key: "ua", title: `${org.name_en}: blocks our bot UA, allows browser UA`, detail: `${org.url} → ${root.blocked ?? "blocked"} with codd-ai UA` });
  if (!blockedHard && !/CERT|SIGNATURE|SSL|TLS/i.test(root.error ?? "") && (root.status === 0 || root.status >= 400)) {
    await openItem(conn, { kind: "dead_link", subject_type: "org", subject_id: org.id, title: `${org.name_en}: ${root.error ?? "HTTP " + root.status}`, detail: org.url });
  }

  const html = root.status === 200 && /html/.test(root.content_type ?? "") ? htmlFacts(root.body, finalUrl) : null;
  if (html) await observe(conn, "org", org.id, "landing", html, finalUrl);

  // Full API sweep on a live page. A challenged page still gets the sweep (APIs are often not behind the WAF).
  // A 404 gets only the directory's platform (the site may live on with a broken deep link). Unreachable hosts get nothing.
  const apiUrl = API_HOME[new URL(finalUrl).host] ?? finalUrl;
  const det =
    root.status === 200 || root.blocked ? await fingerprint(apiUrl, html?.hints ?? [], org.platform_label) :
    root.status === 404 && org.platform_label !== "unknown" ? await fingerprint(apiUrl, [], org.platform_label, true) :
    null;
  if (det && root.status === 404) await openItem(conn, { kind: "data_error", subject_type: "org", subject_id: org.id, key: "stale_url", title: `${org.name_en}: directory URL 404s but ${det.platform} API is live`, detail: `${org.url} → use ${det.base_url}` });
  // A blocked landing page only blocks us if no API answered either.
  if (blockedHard && !det) await openItem(conn, { kind: "blocker", subject_type: "org", subject_id: org.id, key: "root", title: `${org.name_en}: blocked (${root.blocked})`, detail: `${org.url} status ${root.status} even with browser UA; no API found` });
  if (blockedHard && det) await observe(conn, "org", org.id, "html_blocked_api_ok", { blocked: root.blocked, api: det.base_url }, org.url);
  const role = org.relationship && /publish/i.test(org.relationship) ? "published_under" : "primary";
  const t = now();

  if (det) {
    const portalId = `${det.platform}:${new URL(det.base_url).host}${new URL(det.base_url).pathname.replace(/\/$/, "")}`;
    const sources: object[] = [
      { id: portalId, kind: det.platform === "dcat" ? "api" : "portal", platform: det.platform, base_url: det.base_url, scope: null, connector_id: det.platform, status: "identified", dataset_count: det.count, first_seen: t, last_probed: t, notes: det.version ? `version ${det.version}` : null, parent_id: null },
    ];
    let sourceId = portalId;
    if (det.scope) {
      sourceId = `${portalId}#${Object.values(det.scope)[0]}`;
      sources.push({ id: sourceId, kind: "portal_scope", platform: det.platform, base_url: det.base_url, scope: det.scope, connector_id: det.platform, status: "identified", dataset_count: det.scope_count ?? null, first_seen: t, last_probed: t, notes: null, parent_id: portalId });
    }
    await keepFirstSeen(sources);
    await upsert(conn, "org_sources", [{ org_id: org.id, source_id: sourceId, role }]);
    await observe(conn, "org", org.id, "api", { platform: det.platform, base_url: det.base_url, count: det.scope_count ?? det.count, scope: det.scope ?? null }, det.evidence);

    if (org.platform_label !== "unknown" && org.platform_label !== det.platform && !(org.platform_label === "dkan" && det.platform === "dcat"))
      await openItem(conn, { kind: "platform_mismatch", subject_type: "org", subject_id: org.id, title: `${org.name_en}: directory says ${org.platform_label}, API says ${det.platform}`, detail: det.evidence });
    return { id: org.id, outcome: det.platform, count: det.scope_count ?? det.count, reported: org.dataset_count };
  }

  // Nothing machine-readable found: record as a website that needs a human/agent look.
  if (!blockedHard && root.status === 200) {
    const sid = `web:${new URL(finalUrl).host}${new URL(finalUrl).pathname.replace(/\/$/, "")}`;
    await keepFirstSeen([{ id: sid, kind: html && html.pdf_links > 5 ? "document_library" : "website", platform: "unknown", base_url: finalUrl, scope: null, connector_id: null, status: "needs_profiling", dataset_count: null, first_seen: t, last_probed: t, notes: html ? `pdf_links=${html.pdf_links} tabular_links=${html.tabular_links} hints=${html.hints.join("|")}` : null, parent_id: null }]);
    await upsert(conn, "org_sources", [{ org_id: org.id, source_id: sid, role }]);
    await openItem(conn, { kind: "needs_profiling", subject_type: "source", subject_id: sid, title: `${org.name_en}: no known data API found`, detail: `${finalUrl}${html ? ` (pdf ${html.pdf_links}, tabular ${html.tabular_links}, hints ${html.hints.join(",") || "none"})` : ""}` });
  }
  return { id: org.id, outcome: blockedHard ? "blocked" : root.status === 200 ? "unknown" : "dead", reported: org.dataset_count };
}

async function keepFirstSeen(rows: any[]) {
  for (const r of rows) {
    const prev = await all<{ first_seen: string }>(conn, "select first_seen::varchar as first_seen from sources where id = $id", { id: r.id });
    if (prev[0]?.first_seen) r.first_seen = prev[0].first_seen;
  }
  await upsert(conn, "sources", rows);
}

// ---- main ----

let orgs = await all<Org>(conn, "select id, name_en, url, host, platform_label, relationship, dataset_count from orgs order by id");
if (ONLY) orgs = orgs.filter((o) => ONLY.includes(o.id));
orgs = orgs.slice(0, LIMIT);

await upsert(conn, "connectors", ["ckan", "arcgis_hub", "socrata", "opendatasoft", "dataverse", "dcat", "figshare"].map((id) => ({ id, platform: id, status: "planned", description: null, notes: null })));

const limit = pLimit(CONCURRENCY);
let done = 0;
const results = await Promise.all(
  orgs.map((o) =>
    limit(async () => {
      const r = await probeOrg(o).catch((e) => ({ id: o.id, outcome: "error", error: String(e) }));
      done++;
      console.log(`[${done}/${orgs.length}] ${o.id}: ${r.outcome}${"count" in r && r.count != null ? ` (${r.count} live / ${r.reported ?? "NA"} reported)` : ""}`);
      // Flush probe log incrementally so a crash doesn't lose it.
      if (probeRows.length > 200) await upsert(conn, "probes", probeRows.splice(0));
      return r;
    }),
  ),
);
await upsert(conn, "probes", probeRows.splice(0));

const tally: Record<string, number> = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
// Sources no org points at any more (e.g. a website replaced by a detected API).
await all(conn, "delete from sources where id not in (select source_id from org_sources) and id not in (select parent_id from sources where parent_id is not null)");
console.log("\noutcomes:", tally);
console.log("open items:", await all(conn, "select kind, count(*)::int as n from open_items where status='open' group by kind order by n desc"));
await closeDb(conn);
