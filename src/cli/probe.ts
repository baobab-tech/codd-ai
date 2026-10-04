/**
 * Probe every org URL: reachability, bot blocking, robots.txt AI rules, and platform fingerprint via API.
 * Writes probes, sources, org_sources, observations, and open_items.
 *
 *   pnpm probe [--only id1,id2] [--limit n] [--concurrency 8]
 */
import pLimit from "p-limit";
import { all, closeDb, db, observe, openItem, upsert } from "../db.js";
import { API_HOME, fingerprint, get, htmlFacts, logProbe, now, probeRows, robots, sleep } from "../fingerprint.js";
import { BROWSER_UA } from "../http.js";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const ONLY = arg("--only")?.split(",");
const LIMIT = Number(arg("--limit") ?? Infinity);
const CONCURRENCY = Number(arg("--concurrency") ?? 8);


interface Org {
  id: string;
  name_en: string;
  url: string | null;
  host: string | null;
  platform_label: string;
  relationship: string | null;
  dataset_count: number | null;
}

const conn = await db();

// ---- per-org probe ----

const AUTO_KINDS = "('dead_link','blocker','needs_profiling','platform_mismatch','data_error')";

/** Re-probing re-derives an org's sources and auto items, so clear the previous ones first. */
async function resetOrg(org: Org) {
  await all(conn, `update open_items set status = 'stale', updated_at = now() where status = 'open' and kind in ${AUTO_KINDS} and (
      (subject_type = 'org' and subject_id = $id) or
      (subject_type = 'source' and subject_id in (select source_id from org_sources where org_id = $id)))`, { id: org.id });
  await all(conn, "delete from org_sources where org_id = $id and source_id not in (select id from sources where curated)", { id: org.id });
}

const hasCurated = async (orgId: string) =>
  (await all(conn, "select 1 from org_sources os join sources s on s.id = os.source_id where os.org_id = $id and s.curated", { id: orgId })).length > 0;

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

  // Once profiling has decided an org's sources, the probe only records what it sees.
  if (det && (await hasCurated(org.id))) {
    await observe(conn, "org", org.id, "api", { platform: det.platform, base_url: det.base_url, count: det.scope_count ?? det.count, scope: det.scope ?? null, note: "org has curated sources; not linked" }, det.evidence);
    return { id: org.id, outcome: "curated", count: det.scope_count ?? det.count, reported: org.dataset_count };
  }

  if (det) {
    const portalId = `${det.platform}:${new URL(det.base_url).host}${new URL(det.base_url).pathname.replace(/\/$/, "")}`;
    const sources: object[] = [
      { id: portalId, kind: det.platform === "dcat" ? "api" : "portal", platform: det.platform, base_url: det.base_url, scope: null, connector_id: det.platform === "arcgis_server" ? "arcgis_rest" : det.platform, status: "identified", dataset_count: det.count, first_seen: t, last_probed: t, notes: [det.version && `version ${det.version}`, det.folders && `folders: ${det.folders.join(", ")}`].filter(Boolean).join("; ") || null, parent_id: null },
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

  // Nothing machine-readable found: record as a website that needs a human/agent look, unless profiling already did.
  if (await hasCurated(org.id)) return { id: org.id, outcome: "curated", reported: org.dataset_count };
  if (!blockedHard && root.status === 200) {
    const sid = `web:${new URL(finalUrl).host}${new URL(finalUrl).pathname.replace(/\/$/, "")}`;
    await keepFirstSeen([{ id: sid, kind: "website", platform: "unknown", base_url: finalUrl, scope: null, connector_id: null, status: "needs_profiling", dataset_count: null, first_seen: t, last_probed: t, notes: html ? `pdf_links=${html.pdf_links} tabular_links=${html.tabular_links} hints=${html.hints.join("|")}` : null, parent_id: null }]);
    await upsert(conn, "org_sources", [{ org_id: org.id, source_id: sid, role }]);
    await openItem(conn, { kind: "needs_profiling", subject_type: "source", subject_id: sid, title: `${org.name_en}: no known data API found`, detail: `${finalUrl}${html ? ` (pdf ${html.pdf_links}, tabular ${html.tabular_links}, hints ${html.hints.join(",") || "none"})` : ""}` });
  }
  return { id: org.id, outcome: blockedHard ? "blocked" : root.status === 200 ? "unknown" : "dead", reported: org.dataset_count };
}

async function keepFirstSeen(rows: any[]) {
  const keep: any[] = [];
  for (const r of rows) {
    const prev = await all<{ first_seen: string; recipe: unknown; archetype: string | null; curated: boolean }>(conn, "select first_seen::varchar as first_seen, recipe, archetype, curated from sources where id = $id", { id: r.id });
    if (prev[0]?.curated) continue; // profiling owns this row
    keep.push(r);
    if (prev[0]?.first_seen) r.first_seen = prev[0].first_seen;
    // Profiling output is hand/agent-curated; a re-probe must not drop it.
    const prevRecipe = prev[0]?.recipe;
    r.curated = false;
    r.recipe = (typeof prevRecipe === "string" ? JSON.parse(prevRecipe) : prevRecipe) ?? r.recipe ?? null;
    r.archetype = prev[0]?.archetype ?? r.archetype ?? (r.platform === "arcgis_server" ? "esri_rest" : r.platform && r.platform !== "unknown" ? "platform_api" : null);
  }
  await upsert(conn, "sources", keep);
}

// ---- main ----

// Overrides win over the directory URL.
let orgs = await all<Org>(conn, `
  select o.id, o.name_en, coalesce(ov.value, o.url) as url, o.host, o.platform_label, o.relationship, o.dataset_count
  from orgs o left join org_overrides ov on ov.org_id = o.id and ov.field = 'url'
  order by o.id`);
if (ONLY) orgs = orgs.filter((o) => ONLY.includes(o.id));
orgs = orgs.slice(0, LIMIT);

// Register connectors we will need; never touch an existing connector's status.
const known = new Set((await all<{ id: string }>(conn, "select id from connectors")).map((c) => c.id));
await upsert(conn, "connectors", ["ckan", "arcgis_hub", "socrata", "opendatasoft", "dataverse", "dcat", "figshare", "geonetwork", "arcgis_rest"].filter((id) => !known.has(id)).map((id) => ({ id, platform: id === "arcgis_rest" ? "arcgis_server" : id, status: "planned", description: null, notes: null })));

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
await all(conn, "delete from sources where not coalesce(curated, false) and id not in (select source_id from org_sources) and id not in (select parent_id from sources where parent_id is not null)");
console.log("\noutcomes:", tally);
console.log("open items:", await all(conn, "select kind, count(*)::int as n from open_items where status='open' group by kind order by n desc"));
await closeDb(conn);
