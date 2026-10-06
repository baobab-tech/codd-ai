/**
 * Listers for single-publisher APIs (Part 1: registry), each one or two calls:
 *   Bank of Canada Valet (groups of series), Red Deer, Brandon, NatureCounts (metadata only), CONP (metadata only).
 * NatureCounts and CONP data is not openly licensed: the registry lists it and never downloads it (decision 2026-10-06).
 */
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];
async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
  return res.json();
}
type Res = { suffix: string; name: string; url: string; format: string | null };
function record(sourceId: string, native: string, now: string, d: Record<string, unknown>, res: Res[], raw: unknown, modified: string | null = null): HarvestRecord {
  const id = `${sourceId}|${native}`;
  const resources = res.map((r) => ({ id: `${id}|${r.suffix}`, dataset_id: id, source_id: sourceId, name: r.name, url: r.url, format: r.format, mimetype: null, size: null, datastore: false, tier: tierOf(r.format, { url: r.url, name: r.name }), modified }));
  return {
    dataset: {
      id, source_id: sourceId, native_id: native, name: native, title: null, description: null, publisher: null, publisher_title: null, type: "dataset",
      tags: [], licence: null, landing_url: null, created: null, modified, harvested_at: now, themes: [], keywords: [], frequency: null,
      has_spatial: null, bilingual: null, is_open: null, licence_url: null, has_contact: null, access_level: null, extras: {},
      ...d,
      resource_count: resources.length,
      formats: [...new Set(resources.map((r) => r.format).filter(Boolean))],
      best_tier: resources.reduce<string | null>((b, r) => (b === null || TIER_RANK.indexOf(r.tier) > TIER_RANK.indexOf(b) ? r.tier : b), null),
    },
    resources,
    raw,
  };
}

/** Bank of Canada Valet: one dataset per series group, with JSON (live) and CSV observation endpoints. */
export async function* listValet(sourceId: string, base: string) {
  const now = new Date().toISOString();
  const groups = (await getJson(`${base}/lists/groups/json`)).groups ?? {};
  yield Object.entries(groups).map(([name, g]: [string, any]) => record(sourceId, name, now, {
    title: g.label ?? name, description: g.description ?? null, publisher: "bank-of-canada", publisher_title: "Bank of Canada",
    type: "series_group", licence: null, licence_url: "https://www.bankofcanada.ca/terms/", landing_url: g.link ?? null, // the API carries no licence
  }, [
    { suffix: "json", name: "Observations API (JSON; filter by date or recent=N)", url: `${base}/observations/group/${name}/json`, format: "API" },
    { suffix: "csv", name: "Observations CSV", url: `${base}/observations/group/${name}/csv`, format: "CSV" },
  ], { name, ...g }));
}

/** Red Deer's custom portal: paged JSON per dataset, plus listed export formats. */
export async function* listRedDeer(sourceId: string, base: string) {
  const now = new Date().toISOString();
  const j = await getJson(base);
  yield (j.datasets ?? []).map((d: any) => {
    const slug = String(d.dataUrl ?? "").match(/datasets\/([^/?]+)/)?.[1] ?? d.name;
    const files = String(d.formats ?? "").split(/\s*,\s*/).filter(Boolean).map((f: string) => ({ suffix: f.toLowerCase(), name: `${f} download`, url: `${base}/${slug}`, format: normalizeFormat(f === "Shapefile" ? "SHP" : f) }));
    return record(sourceId, slug, now, {
      title: d.name ?? slug, description: d.description ?? null, publisher: d.owner ?? null, publisher_title: d.owner ?? null,
      tags: String(d.keywords ?? "").split(/\s*,\s*/).filter(Boolean), themes: d.category ? [d.category] : [],
      licence: null, landing_url: `https://data.reddeer.ca/data/${slug}`, // the API carries no licence
      created: d.createdDate ?? null, has_spatial: !!d.geographicAreaCovered,
      extras: { views: d.views ?? null, downloads: d.downloads ?? null, data_updated_at: d.lastUpdateDate ?? null, metadata_url: d.metaDataUrl ?? null },
    }, [{ suffix: "api", name: "Paged JSON API (skip/take)", url: d.dataUrl, format: "API" }, ...files], d, d.lastUpdateDate ?? null);
  });
}

/** Brandon's open data service: metadata list, then a CSV export per table (columns must be named; see recipe). */
export async function* listBrandon(sourceId: string, base: string, opts: { recipe?: any } = {}) {
  const now = new Date().toISOString();
  const rows: any[] = await getJson(`${base}?format=json&dataset=metadata&columns=id`).then((j) => (Array.isArray(j) ? j : Object.values(j)[0] as any[]));
  yield rows.map((d) => record(sourceId, d.dataset, now, {
    title: d.name ?? d.dataset, description: d.description ?? null, publisher: "city-of-brandon", publisher_title: "City of Brandon",
    themes: d.category ? [d.category] : [], frequency: d.update_frequency ?? null, has_spatial: d.spatial === "1",
    licence: opts.recipe?.licence ?? "City of Brandon Open Data Licence", licence_url: opts.recipe?.licence_url ?? null,
    landing_url: "http://opengov.brandon.ca/catalog.php", created: d.created ?? null,
    extras: { data_updated_at: d.updated ?? null, access_count: Number(d.accessCount) || null, spatial_service: d.spatialService || null },
  }, [
    { suffix: "json", name: "JSON API (read the schema first: ?format=json&dataset=<name>)", url: `${base}?format=json&dataset=${d.dataset}`, format: "API" },
    { suffix: "csv", name: "CSV export (needs columns=<a real column>)", url: `${base}?format=csv&dataset=${d.dataset}`, format: "CSV" },
  ], d, d.updated && !d.updated.startsWith("1900") ? d.updated : null));
}

const AKN: Record<number, string> = { 5: "free (account required to download)", 4: "by request", 3: "by request", 2: "summaries only", 1: "restricted", 0: "restricted" };
/** NatureCounts: catalogue metadata for every collection; records are never downloaded. */
export async function* listNatureCounts(sourceId: string, base: string) {
  const now = new Date().toISOString();
  const j = await getJson(`${base}/metadata/collections`, { method: "POST", headers: { "content-length": "0" } });
  const n = (j.collection ?? []).length;
  const out: HarvestRecord[] = [];
  for (let i = 0; i < n; i++) {
    const c = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, (v as unknown[])[i]])) as any;
    out.push(record(sourceId, c.collection, now, {
      title: c.collection_name ?? c.collection, description: `Bird observation collection ${c.collection}: ${c.n_records?.toLocaleString?.("en-CA") ?? c.n_records} records at ${c.n_locations ?? "?"} locations, ${c.min_year ?? "?"} to ${c.max_year ?? "?"}. Access: ${AKN[c.akn_level] ?? c.akn_level}.`,
      publisher: "birds-canada", publisher_title: "Birds Canada", type: "collection", bilingual: !!(c.collection_name && c.collection_name_fr),
      licence: "NatureCounts data sharing policy (per collection)", licence_url: "https://naturecounts.ca/nc/default/nc_data_sharing.jsp",
      landing_url: `https://naturecounts.ca/nc/default/datasets.jsp?code=${encodeURIComponent(c.collection)}`, has_spatial: true,
      access_level: c.akn_level === 5 ? "account_required" : "restricted",
      extras: { akn_level: c.akn_level, n_records: c.n_records, n_locations: c.n_locations, min_year: c.min_year, max_year: c.max_year, title_fr: c.collection_name_fr, metadata_only: true },
    }, [{ suffix: "page", name: "Collection page (download needs an account)", url: `https://naturecounts.ca/nc/default/datasets.jsp?code=${encodeURIComponent(c.collection)}`, format: "HTML" }], c));
  }
  yield out;
}

/** CONP: metadata for every dataset; files live on LORIS, Zenodo, OSF and Brain-CODE and are never fetched. */
export async function* listConp(sourceId: string, base: string) {
  const now = new Date().toISOString();
  const j = await getJson(`${base}/dataset-search?cursor=0&limit=1000&max_per_page=1000&page=1`);
  yield (j.elements ?? []).map((d: any) => record(sourceId, d.id, now, {
    title: d.title ?? d.id, description: [d.origin, d.modalities?.length && `Modalities: ${d.modalities.join(", ")}.`, d.size && `Size: ${d.size}, ${d.files ?? "?"} files.`].filter(Boolean).join(" ") || null,
    publisher: (d.creators ?? [])[0] ?? null, publisher_title: (d.creators ?? [])[0] ?? null, type: "dataset",
    tags: d.modalities ?? [], licence: (d.licenses ?? []).join("; ") || null, landing_url: `${base}/dataset?id=${encodeURIComponent(d.id)}`,
    created: d.dateAdded ?? null, access_level: d.authorizations ?? null, has_contact: null,
    extras: { ark: d.ark_id ?? null, formats: d.formats ?? [], files: d.files ?? null, size: d.size ?? null, sources: d.sources ?? null, metadata_only: true, terms: "ethics or other approvals required" },
  }, [{ suffix: "source", name: "Data host (access terms apply)", url: String(d.sources ?? d.remoteUrl ?? "").trim() || `${base}/dataset?id=${encodeURIComponent(d.id)}`, format: "HTML" }], d, d.dateUpdated ?? null));
}
