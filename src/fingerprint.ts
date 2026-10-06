/** Shared HTTP probing: host-serialized GET, probe log, robots.txt, landing-page facts, and platform fingerprints. */
import * as cheerio from "cheerio";
import { type FetchResult, fetchText, json } from "./http.js";

// Directory URLs that are a front end for an API hosted elsewhere. Value is the URL to fingerprint instead.
export const API_HOME: Record<string, string> = {
  "search.open.canada.ca": "https://open.canada.ca/data/",
  "open.toronto.ca": "https://ckan0.cf.opendata.inter.prod-toronto.ca/",
};

export const AI_AGENTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "CCBot", "Google-Extended", "PerplexityBot", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot"];

export interface Detected {
  platform: string;
  base_url: string;
  count: number | null;
  scope?: Record<string, string>;
  scope_count?: number | null;
  version?: string | null;
  evidence: string;
  folders?: string[];              // arcgis_server: top-level folders, for choosing what is open data
}

export const now = () => new Date().toISOString();
export const probeRows: object[] = [];

export function logProbe(check: string, r: FetchResult, result: unknown = null) {
  probeRows.push({ url: r.url, check, status: r.status, final_url: r.final_url, content_type: r.content_type, server: r.server, blocked: r.blocked, ms: r.ms, error: r.error, result, fetched_at: now() });
}

// Serialize requests per host, spaced by HOST_GAP_MS, so we never burst one server.
export const HOST_GAP_MS = 500;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hostChains = new Map<string, Promise<unknown>>();
function onHost<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostChains.get(host) ?? Promise.resolve();
  const run = () => sleep(HOST_GAP_MS).then(fn);
  const next = prev.then(run, run);
  hostChains.set(host, next.catch(() => {}));
  return next;
}
export const get = (url: string, opts?: Parameters<typeof fetchText>[1]) => onHost(new URL(url).host, () => fetchText(url, opts));

// robots.txt, once per host.
const robotsCache = new Map<string, Promise<Record<string, unknown> | null>>();
export function robots(origin: string) {
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
  // "Disallow: /" with Allow lines is an allowlist (only the listed paths may be crawled), not a blanket block.
  const blocksAll = (g?: (typeof groups)[number]) => !!g && g.disallow.includes("/") && g.allow.length === 0;
  const allowlist = (g?: (typeof groups)[number]) => !!g && g.disallow.includes("/") && g.allow.length > 0 && !g.allow.includes("/");
  const star = groupFor("*");
  const named = AI_AGENTS.filter((a) => groupFor(a));
  return {
    present: true,
    star_disallow_all: blocksAll(star),
    star_allowlist: allowlist(star),
    star_disallows_api: !!star?.disallow.some((d) => /^\/(api|data\/api)/.test(d)),
    ai_agents_named: named,
    ai_agents_blocked: named.filter((a) => blocksAll(groupFor(a))),
    content_signal: signals,
    sitemap: /^\s*sitemap\s*:/im.test(txt),
  };
}

export function htmlFacts(body: string, baseUrl: string) {
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
    /\/rest\/services/.test(text) && "arcgis_server",
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

export async function tryCkan(origin: string, path: string): Promise<Detected | null> {
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

export async function tryHub(origin: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/search/v1/collections/dataset/items?limit=1`);
  const j = json(r);
  logProbe("arcgis_hub", r, j ? { count: j.numberMatched } : null);
  if (j && typeof j.numberMatched === "number") return { platform: "arcgis_hub", base_url: origin, count: j.numberMatched, evidence: r.url };
  // Some Hub sites answer 404 on the dataset collection but serve collections/all (gisdata.nanaimo.ca).
  if (r.status === 404) {
    const a = await get(`${origin}/api/search/v1/collections/all/items?limit=1`);
    const aj = json(a);
    logProbe("arcgis_hub_all", a, aj ? { count: aj.numberMatched } : null);
    if (aj && typeof aj.numberMatched === "number") return { platform: "arcgis_hub", base_url: origin, count: aj.numberMatched, version: "dataset collection 404; all items", evidence: a.url };
  }
  // Some Hub sites have a broken search API ("Site catalog is not configured correctly") but a working DCAT feed.
  if (r.status === 400 && /Site catalog/.test(r.body)) {
    const f = await get(`${origin}/api/feed/dcat-us/1.1.json`, { accept: "application/json", timeoutMs: 60_000 });
    const fj = json(f);
    logProbe("arcgis_hub_feed", f, fj ? { count: fj.dataset?.length } : null);
    if (Array.isArray(fj?.dataset)) return { platform: "arcgis_hub", base_url: origin, count: fj.dataset.length, version: "search API broken; dcat feed only", evidence: f.url };
  }
  return null;
}

export async function trySocrata(origin: string, host: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/catalog/v1?domains=${host}&search_context=${host}&only=dataset&limit=1`);
  const j = json(r);
  logProbe("socrata", r, j ? { count: j.resultSetSize } : null);
  if (j && typeof j.resultSetSize === "number") return { platform: "socrata", base_url: origin, count: j.resultSetSize, evidence: r.url };
  return null;
}

export async function tryOds(origin: string): Promise<Detected | null> {
  const r = await get(`${origin}/api/explore/v2.1/catalog/datasets?limit=1`);
  const j = json(r);
  logProbe("opendatasoft", r, j ? { count: j.total_count } : null);
  if (j && typeof j.total_count === "number") return { platform: "opendatasoft", base_url: origin, count: j.total_count, evidence: r.url };
  return null;
}

export async function tryDataverse(origin: string, path: string): Promise<Detected | null> {
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

export async function tryGeonetwork(origin: string, path: string): Promise<Detected | null> {
  // GeoNetwork 3/4 sits at /geonetwork by default; some installs mount it at the root.
  const prefixes = [...new Set([path.match(/^\/[^/]*geonetwork[^/]*/i)?.[0] ?? "/geonetwork", ""])];
  for (const p of prefixes) {
    const r = await get(`${origin}${p}/srv/api/site`, { accept: "application/json" });
    const j = json(r);
    logProbe("geonetwork", r, j ? { version: j["system/platform/version"] } : null);
    if (!j?.["system/platform/version"]) continue;
    const base = `${origin}${p}`;
    const c = await get(`${base}/srv/eng/csw?service=CSW&version=2.0.2&request=GetRecords&typeNames=csw:Record&resultType=hits`, { accept: "application/xml" });
    const hits = c.body.match(/numberOfRecordsMatched="(\d+)"/)?.[1];
    logProbe("geonetwork_csw", c, hits ? { count: Number(hits) } : null);
    return { platform: "geonetwork", base_url: base, count: hits ? Number(hits) : null, version: j["system/platform/version"], evidence: r.url };
  }
  return null;
}

/** ArcGIS Server (Enterprise) services directory. Count = services across root and one level of folders. */
export async function tryEsriRest(origin: string, path: string): Promise<Detected | null> {
  const fromPath = path.match(/^(\/[^/]+)\/rest\/services/)?.[1];
  const prefixes = [...new Set([fromPath, "/arcgis", "/server", "/gis"].filter(Boolean) as string[])];
  for (const p of prefixes) {
    const root = `${origin}${p}/rest/services`;
    const r = await get(`${root}?f=json`, { accept: "application/json" });
    const j = json(r);
    logProbe("arcgis_server", r, j ? { version: j.currentVersion, folders: j.folders?.length, services: j.services?.length } : null);
    if (typeof j?.currentVersion !== "number") continue;
    let services = j.services?.length ?? 0;
    for (const f of (j.folders ?? []).slice(0, 40)) {
      const fj = json(await get(`${root}/${encodeURIComponent(f)}?f=json`, { accept: "application/json" }));
      services += fj?.services?.length ?? 0;
    }
    return { platform: "arcgis_server", base_url: root, count: services, version: String(j.currentVersion), evidence: r.url, folders: j.folders ?? [] };
  }
  return null;
}

export async function tryDcat(origin: string): Promise<Detected | null> {
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

export async function fingerprint(url: string, hints: string[], label: string, labelOnly = false): Promise<Detected | null> {
  const u = new URL(url);
  const { origin, pathname: path, host } = u;
  if (/(^|\.)figshare\.com$/.test(host)) return { platform: "figshare", base_url: "https://api.figshare.com/v2", count: null, evidence: "host" };
  const order = labelOnly ? [label] : [...new Set([label, ...hints, "ckan", "arcgis_hub", "socrata", "opendatasoft", "dataverse", "geonetwork", "arcgis_server"])];
  for (const p of order) {
    const d =
      p === "ckan" ? await tryCkan(origin, path) :
      p === "arcgis_hub" ? await tryHub(origin) :
      p === "socrata" ? await trySocrata(origin, host) :
      p === "opendatasoft" ? await tryOds(origin) :
      p === "dataverse" ? await tryDataverse(origin, path) :
      p === "geonetwork" ? await tryGeonetwork(origin, path) :
      p === "arcgis_server" ? await tryEsriRest(origin, path) :
      null;
    if (d) return d;
  }
  return labelOnly ? null : tryDcat(origin);
}
