/**
 * Opendatasoft catalog listing (Part 1: registry), through the Explore API v2.1. Each dataset with records gets a
 * live records API plus CSV, GeoJSON and Parquet exports; attachments become file resources. The catalogue
 * already carries fields, row count and the data-processed time, so no describe pass is needed.
 */
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const PAGE = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.json();
    } catch (e) {
      if (i >= tries || String(e).includes("not retried")) throw e;
      await sleep(5_000 * i * i);
    }
  }
}

const stripHtml = (s: unknown) => (typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() || null : null);

export function mapOds(sourceId: string, base: string, x: any, now: string): HarvestRecord {
  const d = x.metas?.default ?? {};
  const dcat = x.metas?.dcat ?? {};
  const id = `${sourceId}|${x.dataset_id}`;
  const api = `${base}/api/explore/v2.1/catalog/datasets/${x.dataset_id}`;
  const res = (suffix: string, name: string, url: string, format: string | null) => ({
    id: `${id}|${suffix}`, dataset_id: id, source_id: sourceId, name, url, format, mimetype: null, size: null, datastore: false,
    tier: tierOf(format, { url, name }), modified: d.data_processed ?? d.modified ?? null,
  });
  const resources: Record<string, unknown>[] = [];
  if (x.has_records) {
    resources.push(res("records", "Records API (ODSQL)", `${api}/records`, "API"));
    resources.push(res("csv", "CSV export", `${api}/exports/csv`, "CSV"));
    resources.push(res("parquet", "Parquet export", `${api}/exports/parquet`, "PARQUET"));
    if (d.geometry_types?.length || (x.fields ?? []).some((f: any) => /geo_/.test(f.type))) resources.push(res("geojson", "GeoJSON export", `${api}/exports/geojson`, "GEOJSON"));
  }
  for (const a of x.attachments ?? []) resources.push(res(`att-${a.id}`, a.title ?? a.id, `${api}/attachments/${a.id}`, normalizeFormat(a.mimetype, a.url ?? a.id)));
  const langs: string[] = d.metadata_languages ?? [];
  return {
    dataset: {
      id,
      source_id: sourceId,
      native_id: x.dataset_id,
      name: x.dataset_id,
      title: d.title ?? null,
      description: stripHtml(d.description)?.slice(0, 20_000) ?? null,
      publisher: d.publisher ?? null,
      publisher_title: d.publisher ?? null,
      type: x.has_records ? "dataset" : "attachments",
      tags: d.keyword ?? [],
      licence: d.license ?? null,
      landing_url: `${base}/explore/dataset/${x.dataset_id}/`,
      created: dcat.created ?? dcat.issued ?? null,
      modified: d.modified ?? null,
      harvested_at: now,
      themes: d.theme ?? [],
      keywords: [],
      frequency: d.update_frequency ?? dcat.accrualperiodicity ?? null,
      has_spatial: !!(d.geometry_types?.length || d.bbox || d.territory),
      bilingual: langs.length ? langs.includes("en") && langs.includes("fr") : null,
      is_open: null,
      licence_url: d.license_url ?? null,
      has_contact: !!(dcat.contact_email || dcat.contact_name),
      resource_count: resources.length,
      formats: [...new Set(resources.map((r) => r.format).filter(Boolean))],
      best_tier: resources.reduce<string | null>((b, r) => (b === null || TIER_RANK.indexOf(r.tier as string) > TIER_RANK.indexOf(b) ? (r.tier as string) : b), null),
      access_level: x.visibility === "domain" ? null : x.visibility ?? null,
      extras: {
        columns: (x.fields ?? []).map((f: any) => ({ name: f.name, label: f.label, type: f.type })),
        records_count: d.records_count ?? null, data_updated_at: d.data_processed ?? null, federated: d.federated ?? null, source_domain: d.source_domain ?? null,
      },
    },
    resources,
    raw: x,
  };
}

export async function* listOpendatasoft(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  let offset = 0, total = Infinity;
  while (offset < total) {
    const j = await getJson(`${base}/api/explore/v2.1/catalog/datasets?limit=${PAGE}&offset=${offset}&order_by=dataset_id`);
    total = j.total_count ?? 0;
    opts.onPage?.(offset, total);
    const rows: any[] = j.results ?? [];
    if (!rows.length) break;
    yield rows.map((x) => mapOds(sourceId, base, x, now));
    offset += rows.length;
    if (offset < total) await sleep(opts.gapMs ?? 1_000);
  }
}
