/**
 * Auto-profile sources the probe could not identify (status needs_profiling, not curated).
 *
 * For each: read the landing page, fingerprint linked hosts that look like data portals, follow a few
 * same-host data pages, collect file links by type, test links that look like JSON APIs, and look for
 * signs of a JS-only app. Then route the result:
 *
 *   applied       a known platform API answered → curated source, status identified. No review needed.
 *   needs_review  a plausible proposal an agent can verify (JSON API, file listing, JS app needing a browser).
 *   needs_human   a judgement call: documents, nothing data-like found, Esri folder selection, blocked.
 *
 *   pnpm autoprofile [--only org1,org2] [--dry-run]
 */
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { all, closeDb, db, observe, openItem, upsert } from "../db.js";
import { type Detected, fingerprint, get, logProbe, now, probeRows } from "../fingerprint.js";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const ONLY = arg("--only")?.split(",");
const DRY = process.argv.includes("--dry-run");

const TABULAR = /\.(csv|xlsx?|json|geojson|parquet|xml|txt|ods)$/i;
const GEO = /\.(zip|shp|kml|kmz|gpkg|gdb|dwg|tif|tiff|las|laz)$/i;
const DOCS = /\.(pdf|docx?|pptx?|rtf)$/i;
const DATA_PAGE = /data|dataset|donn[eé]es|catalog|catalogue|download|t[eé]l[eé]charg|open|gis|statistic|api/i;
const PORTAL_HOST = /arcgis|hub\.|opendata|open\.|data\.|donnees|ckan|socrata|geonetwork|geoportal|catalog|maps?\.|gis\./i;
const API_LINK = /\/api(\/|\?|$)|swagger|openapi|developer|\/rest\/|\/wds\/|\/valet\/|\/odata/i;

interface Link {
  url: string;
  text: string;
}

interface Profile {
  landing: string;
  status: number;
  blocked: string | null;
  pages: string[];
  files: { tabular: string[]; geo: string[]; docs: string[] };
  api_links: string[];
  json_apis: string[];
  candidates: string[];
  platform: Detected | null;
  js_app: boolean;
  scripts: number;
  links: number;
  text_chars: number;
}

function parse(body: string, base: string): { links: Link[]; scripts: number; text: number } {
  const $ = cheerio.load(body);
  const links: Link[] = [];
  $("a[href]").each((_, a) => {
    try {
      const u = new URL($(a).attr("href")!, base);
      if (/^https?:$/.test(u.protocol)) links.push({ url: u.href.split("#")[0], text: $(a).text().trim().slice(0, 120) });
    } catch {}
  });
  return { links, scripts: $("script").length, text: $("body").text().replace(/\s+/g, " ").length };
}

const pathOf = (u: string) => new URL(u).pathname;
const uniq = <T>(a: T[]) => [...new Set(a)];

async function profile(url: string): Promise<Profile> {
  const root = await get(url);
  logProbe("autoprofile_root", root);
  const base = root.final_url ?? url;
  const p: Profile = { landing: base, status: root.status, blocked: root.blocked, pages: [base], files: { tabular: [], geo: [], docs: [] }, api_links: [], json_apis: [], candidates: [], platform: null, js_app: false, scripts: 0, links: 0, text_chars: 0 };
  if (root.status !== 200) return p;

  const first = parse(root.body, base);
  p.scripts = first.scripts;
  p.links = first.links.length;
  p.text_chars = first.text;
  const host = new URL(base).host;
  let links = first.links;

  // Follow up to 4 same-host pages that look like data pages.
  const follow = uniq(
    links
      .filter((l) => new URL(l.url).host === host && l.url !== base && !TABULAR.test(pathOf(l.url)) && !GEO.test(pathOf(l.url)) && !DOCS.test(pathOf(l.url)))
      .filter((l) => DATA_PAGE.test(pathOf(l.url)) || DATA_PAGE.test(l.text))
      .map((l) => l.url),
  ).slice(0, 4);
  for (const f of follow) {
    const r = await get(f);
    logProbe("autoprofile_page", r);
    if (r.status === 200 && /html/.test(r.content_type ?? "")) {
      links = links.concat(parse(r.body, r.final_url ?? f).links);
      p.pages.push(f);
    }
  }

  const all_ = uniq(links.map((l) => l.url));
  p.files.tabular = all_.filter((u) => TABULAR.test(pathOf(u)));
  p.files.geo = all_.filter((u) => GEO.test(pathOf(u)));
  p.files.docs = all_.filter((u) => DOCS.test(pathOf(u)));
  p.api_links = all_.filter((u) => API_LINK.test(u)).slice(0, 20);

  // Linked hosts that look like portals (including the landing host itself), fingerprinted in order.
  const hosts = uniq(all_.map((u) => new URL(u)).filter((u) => u.host !== host && PORTAL_HOST.test(u.host + u.pathname)).map((u) => u.origin + (u.pathname.match(/^\/[^/]*(geonetwork|arcgis|server)[^/]*/i)?.[0] ?? "/")));
  p.candidates = hosts.slice(0, 4);
  for (const c of p.candidates) {
    const d = await fingerprint(c, [], "unknown");
    if (d && d.platform !== "dcat") {
      p.platform = d;
      break;
    }
  }

  // Test up to 3 API-looking links for JSON.
  if (!p.platform) {
    for (const a of p.api_links.filter((u) => !/swagger|developer/i.test(u)).slice(0, 3)) {
      const r = await get(a, { accept: "application/json" });
      logProbe("autoprofile_api", r);
      if (r.status === 200 && (/json/.test(r.content_type ?? "") || /^\s*[[{]/.test(r.body.slice(0, 50)))) p.json_apis.push(a);
    }
  }

  // JS-only app: little text and few links, but lots of script.
  p.js_app = p.links < 25 && p.scripts >= 5 && p.text_chars < 3000;
  return p;
}

/** A detected portal is shared if it is already a source for some other org. */
async function isSharedPortal(d: Detected, orgId: string) {
  const id = `${d.platform}:${new URL(d.base_url).host}${new URL(d.base_url).pathname.replace(/\/$/, "")}`;
  return (await all(conn, "select 1 from org_sources where (source_id = $id or source_id like $id || '#%') and org_id <> $org", { id, org: orgId })).length > 0;
}

/** Look the org up by name among a CKAN portal's organizations. */
async function ckanOrgScope(base: string, name: string): Promise<{ name: string; title: string; count: number } | null> {
  const q = name.replace(/\(.*?\)/g, "").trim();
  const r = await get(`${base}/api/3/action/organization_autocomplete?q=${encodeURIComponent(q)}&limit=5`, { accept: "application/json" });
  logProbe("ckan_org_lookup", r);
  let hit: { name: string; title: string } | undefined;
  try {
    const res = JSON.parse(r.body)?.result as { name: string; title: string }[] | undefined;
    const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
    hit = res?.find((o) => norm(o.title).includes(norm(q)) || norm(q).includes(norm(o.title.split("|")[0])));
  } catch {}
  if (!hit) return null;
  const c = await get(`${base}/api/3/action/package_search?rows=0&fq=organization:${hit.name}`, { accept: "application/json" });
  const count = JSON.parse(c.body || "{}")?.result?.count ?? 0;
  return { ...hit, count };
}

interface Src {
  source_id: string;
  base_url: string;
  org_id: string;
  name_en: string;
  role: string;
}

const conn = await db();
let srcs = await all<Src>(conn, `
  select s.id as source_id, s.base_url, os.org_id, o.name_en, os.role
  from sources s join org_sources os on os.source_id = s.id join orgs o on o.id = os.org_id
  where s.status = 'needs_profiling' and not coalesce(s.curated, false) order by o.dataset_count desc nulls last, o.id`);
if (ONLY) srcs = srcs.filter((s) => ONLY.includes(s.org_id));

async function route(s: Src, p: Profile) {
  const t = now();
  const nTab = p.files.tabular.length;
  const nGeo = p.files.geo.length;
  const nDoc = p.files.docs.length;
  const evidence = `${p.landing} (pages ${p.pages.length}, tabular ${nTab}, geo ${nGeo}, docs ${nDoc}, api links ${p.api_links.length}, json apis ${p.json_apis.length}, scripts ${p.scripts}, links ${p.links})`;
  await observe(conn, "org", s.org_id, "autoprofile", { ...p, files: { tabular: nTab, geo: nGeo, docs: nDoc, sample: [...p.files.tabular, ...p.files.geo, ...p.files.docs].slice(0, 15) }, platform: p.platform && { platform: p.platform.platform, base_url: p.platform.base_url, count: p.platform.count } }, p.landing);

  let decision: { outcome: string; archetype: string; status: string; id: string; base_url: string; platform: string; count: number | null; recipe: object | null; notes: string; scope?: object; parent_id?: string; item?: { kind: string; title: string; detail: string } };

  if (p.status !== 200) {
    decision = { outcome: "needs_human", archetype: "not_data", status: "needs_human", id: s.source_id, base_url: s.base_url, platform: "unknown", count: null, recipe: null, notes: `landing ${p.status}${p.blocked ? ` ${p.blocked}` : ""}`,
      item: { kind: "needs_human", title: `${s.name_en}: landing page not reachable for profiling (${p.blocked ?? p.status})`, detail: `${s.base_url}. Is there another URL for this org's data?` } };
  } else if (p.platform && (await isSharedPortal(p.platform, s.org_id))) {
    // The page links to a portal other orgs already use. Find this org inside it, or ask.
    const d = p.platform;
    const portalId = `${d.platform}:${new URL(d.base_url).host}${new URL(d.base_url).pathname.replace(/\/$/, "")}`;
    const scope = d.platform === "ckan" ? await ckanOrgScope(d.base_url, s.name_en) : null;
    decision = scope
      ? { outcome: "applied", archetype: "platform_api", status: "identified", id: `${portalId}#organization:${scope.name}`, base_url: d.base_url, platform: "ckan", count: scope.count,
          recipe: null, notes: `autoprofile: publishes inside ${portalId} as CKAN organization '${scope.name}' (${scope.title})`, scope: { ckan_fq: `organization:${scope.name}` }, parent_id: portalId }
      : { outcome: "needs_review", archetype: "platform_api", status: "proposed", id: s.source_id, base_url: p.landing, platform: d.platform, count: null,
          recipe: { linked_portal: portalId, landing: p.landing }, notes: `autoprofile: links to shared portal ${portalId}; org scope not found`,
          item: { kind: "needs_review", title: `${s.name_en}: find this org's datasets inside ${portalId}`, detail: `${p.landing} links to ${d.base_url}, which other orgs also use. Find the publisher filter (organization, owner, group) or confirm it is only a reference.` } };
  } else if (p.platform) {
    const d = p.platform;
    const esri = d.platform === "arcgis_server";
    const openFolders = (d.folders ?? []).filter((f) => /open.?data|donn[eé]es.?ouvertes|public/i.test(f));
    decision = {
      outcome: esri && !openFolders.length ? "needs_human" : "applied",
      archetype: esri ? "esri_rest" : "platform_api",
      status: esri && !openFolders.length ? "needs_human" : "identified",
      id: `${d.platform}:${new URL(d.base_url).host}${new URL(d.base_url).pathname.replace(/\/$/, "")}`,
      base_url: d.base_url, platform: d.platform, count: d.count,
      recipe: esri ? { services_root: d.base_url, folders: openFolders.length ? openFolders : null, all_folders: d.folders } : null,
      notes: `autoprofile: linked from ${p.landing}${d.version ? `; version ${d.version}` : ""}`,
      item: esri && !openFolders.length ? { kind: "needs_human", title: `${s.name_en}: which ArcGIS Server folders are open data?`, detail: `${d.base_url} has ${d.count} services in folders: ${(d.folders ?? []).join(", ")}. None is named as open data. Internal operational layers are often public on the same server (see Banff).` } : undefined,
    };
  } else if (p.json_apis.length) {
    decision = { outcome: "needs_review", archetype: "known_api", status: "proposed", id: s.source_id, base_url: p.json_apis[0], platform: "custom", count: null,
      recipe: { json_endpoints: p.json_apis, api_links: p.api_links, landing: p.landing }, notes: "autoprofile: JSON endpoints found on data pages",
      item: { kind: "needs_review", title: `${s.name_en}: verify JSON API and write recipe`, detail: `Endpoints: ${p.json_apis.join(" ")}` } };
  } else if (nTab + nGeo >= 3 && nTab + nGeo >= nDoc) {
    const hosts = uniq([...p.files.tabular, ...p.files.geo].map((u) => new URL(u).host));
    const exts = uniq([...p.files.tabular, ...p.files.geo].map((u) => pathOf(u).split(".").pop()!.toLowerCase()));
    decision = { outcome: "needs_review", archetype: "web_listing", status: "proposed", id: s.source_id, base_url: p.landing, platform: "unknown", count: null,
      recipe: { start_urls: p.pages, file_hosts: hosts, extensions: exts, file_count: nTab + nGeo, doc_count: nDoc, sample: [...p.files.tabular, ...p.files.geo].slice(0, 10) }, notes: "autoprofile: static file listing",
      item: { kind: "needs_review", title: `${s.name_en}: confirm file listing (${nTab + nGeo} data files)`, detail: `${p.pages.join(" ")}; extensions ${exts.join(",")}; ${nDoc} documents alongside` } };
  } else if (nDoc >= 3) {
    decision = { outcome: "needs_human", archetype: "document_library", status: "needs_human", id: s.source_id, base_url: p.landing, platform: "unknown", count: null,
      recipe: { start_urls: p.pages, doc_count: nDoc, data_file_count: nTab + nGeo, sample: p.files.docs.slice(0, 10) }, notes: "autoprofile: mostly documents",
      item: { kind: "needs_human", title: `${s.name_en}: documents, not datasets (${nDoc} docs, ${nTab + nGeo} data files)`, detail: `${p.pages.join(" ")}. Ingest as documents, look elsewhere for data, or skip?` } };
  } else if (p.js_app || p.api_links.length || p.scripts >= 10) {
    // Script-heavy pages with no visible data usually load it client-side: an agent with a browser goes first.
    decision = { outcome: "needs_review", archetype: "js_app", status: "proposed", id: s.source_id, base_url: p.landing, platform: "unknown", count: null,
      recipe: { landing: p.landing, api_links: p.api_links, scripts: p.scripts, links: p.links }, notes: "autoprofile: client-side app or undocumented API; inspect network calls in a browser",
      item: { kind: "needs_review", title: `${s.name_en}: inspect in a browser to find the backing API`, detail: `${p.landing}; scripts ${p.scripts}, links ${p.links}${p.api_links.length ? `; api-looking links: ${p.api_links.slice(0, 5).join(" ")}` : ""}` } };
  } else {
    decision = { outcome: "needs_human", archetype: "not_data", status: "needs_human", id: s.source_id, base_url: p.landing, platform: "unknown", count: null,
      recipe: { pages: p.pages, files: nTab + nGeo + nDoc }, notes: "autoprofile: no data, API or documents found",
      item: { kind: "needs_human", title: `${s.name_en}: no data found on the linked page`, detail: `${evidence}. Is this a data source, is the data elsewhere, or skip?` } };
  }

  if (DRY) return { ...decision, evidence };

  await upsert(conn, "sources", [{
    id: decision.id, kind: decision.parent_id ? "portal_scope" : decision.archetype === "platform_api" ? "portal" : decision.archetype === "document_library" ? "document_library" : decision.archetype === "web_listing" ? "website" : "api",
    platform: decision.platform, base_url: decision.base_url, scope: decision.scope ?? null,
    connector_id: decision.archetype === "platform_api" ? decision.platform : decision.archetype === "esri_rest" ? "arcgis_rest" : ["web_listing", "known_api"].includes(decision.archetype) ? decision.archetype : null,
    status: decision.status, dataset_count: decision.count, first_seen: t, last_probed: t, notes: decision.notes, parent_id: decision.parent_id ?? null,
    recipe: decision.recipe, curated: true, archetype: decision.archetype,
  }]);
  if (decision.id !== s.source_id) {
    await all(conn, "delete from org_sources where org_id = $o and source_id = $s", { o: s.org_id, s: s.source_id });
    await all(conn, "delete from sources where id = $s and id not in (select source_id from org_sources)", { s: s.source_id });
    await upsert(conn, "org_sources", [{ org_id: s.org_id, source_id: decision.id, role: s.role }]);
  }
  await all(conn, "update open_items set status = 'resolved', resolution = $r, updated_at = now() where kind = 'needs_profiling' and subject_id = $s and status in ('open','stale')", { r: `autoprofile → ${decision.outcome}: ${decision.archetype} (${decision.id})`, s: s.source_id });
  if (decision.item) await openItem(conn, { kind: decision.item.kind, subject_type: "source", subject_id: decision.id, title: decision.item.title, detail: decision.item.detail });
  return { ...decision, evidence };
}

const limit = pLimit(6);
let done = 0;
const results = await Promise.all(
  srcs.map((s) =>
    limit(async () => {
      const p = await profile(s.base_url).catch((e) => ({ error: String(e) }) as never);
      const r = "error" in p ? { outcome: "error", archetype: "-", id: s.source_id, evidence: String((p as { error: string }).error) } : await route(s, p);
      console.log(`[${++done}/${srcs.length}] ${s.org_id}: ${r.outcome} ${r.archetype} → ${r.id}\n    ${r.evidence}`);
      if (probeRows.length > 200) await upsert(conn, "probes", probeRows.splice(0));
      return r;
    }),
  ),
);
await upsert(conn, "probes", probeRows.splice(0));
const tally: Record<string, number> = {};
for (const r of results) tally[`${r.outcome}/${r.archetype}`] = (tally[`${r.outcome}/${r.archetype}`] ?? 0) + 1;
console.log("\n", tally);
await closeDb(conn);
