/**
 * Socrata catalog listing (Part 1: registry). Pages through the Discovery API (`/api/catalog/v1`) by offset,
 * ordered by dataset_id (scroll_id paging repeated and skipped assets on data.winnipeg.ca) and maps assets to dataset/resource rows. Query-time access (SODA) is Part 2.
 *
 * The catalogue record already carries the column list and a real data-update time, so Socrata datasets need
 * no describe pass for schema or freshness.
 */
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const PAGE = 200;
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

const meta = (dm: { key: string; value: string }[] | undefined, re: RegExp) => dm?.find((m) => re.test(m.key) && m.value)?.value ?? null;

export function mapAsset(sourceId: string, base: string, a: any, now: string): HarvestRecord {
  const r = a.resource ?? {};
  const c = a.classification ?? {};
  const id = `${sourceId}|${r.id}`;
  const res = (suffix: string, name: string, url: string, format: string | null, extra: Partial<Record<string, unknown>> = {}) => ({
    id: `${id}|${suffix}`, dataset_id: id, source_id: sourceId, name, url, format, mimetype: null, size: null, datastore: false,
    tier: tierOf(format, { url, name }), modified: r.data_updated_at ?? r.updatedAt ?? null, ...extra,
  });
  const resources: Record<string, unknown>[] = [];
  if (r.type === "dataset" || r.type === "filter") {
    resources.push(res("soda", "SODA API (query with SoQL)", `${base}/resource/${r.id}.json`, "SODA"));
    resources.push(res("csv", "CSV export", `${base}/api/views/${r.id}/rows.csv?accessType=DOWNLOAD`, "CSV"));
  } else if (r.type === "map") {
    resources.push(res("geojson", "GeoJSON export", `${base}/api/geospatial/${r.id}?method=export&format=GeoJSON`, "GEOJSON"));
    resources.push(res("shp", "Shapefile export", `${base}/api/geospatial/${r.id}?method=export&format=Shapefile`, "SHP"));
  } else if (r.type === "file" || r.type === "href") {
    const fmt = r.blob_mime_type ? normalizeFormat(r.blob_mime_type) : null;
    resources.push(res("file", r.type === "href" ? "External link" : "Attached file", r.type === "href" ? (a.link ?? a.permalink) : `${base}/download/${r.id}/${encodeURIComponent(r.blob_mime_type ?? "application/octet-stream")}`, fmt));
  }
  const dm = c.domain_metadata as { key: string; value: string }[] | undefined;
  const columns = (r.columns_field_name ?? []).map((f: string, i: number) => ({ name: r.columns_name?.[i] ?? f, field: f, type: r.columns_datatype?.[i] ?? null }));
  return {
    dataset: {
      id,
      source_id: sourceId,
      native_id: r.id,
      name: r.id,
      title: r.name ?? null,
      description: r.description?.slice(0, 20_000) || null,
      publisher: r.attribution ?? meta(dm, /department|publisher|source/i) ?? r.owner?.display_name ?? a.owner?.display_name ?? null,
      publisher_title: r.attribution ?? meta(dm, /department|publisher|source/i) ?? null,
      type: r.type ?? null,
      tags: [...new Set([...(c.tags ?? []), ...(c.domain_tags ?? [])])],
      licence: a.metadata?.license ?? meta(dm, /licen[cs]e/i),
      landing_url: a.permalink ?? a.link ?? null,
      created: r.createdAt ?? null,
      modified: r.updatedAt ?? null,
      harvested_at: now,
      themes: [...new Set([...(c.categories ?? []), c.domain_category].filter(Boolean))],
      keywords: [],
      frequency: meta(dm, /frequen|interval/i),
      has_spatial: r.type === "map" || (r.columns_datatype ?? []).some((t: string) => /point|polygon|line|location/i.test(t)),
      bilingual: null,
      is_open: null,
      licence_url: null,
      has_contact: !!r.contact_email,
      resource_count: resources.length,
      formats: [...new Set(resources.map((x) => x.format).filter(Boolean))],
      best_tier: resources.reduce<string | null>((b, x) => (b === null || TIER_RANK.indexOf(x.tier as string) > TIER_RANK.indexOf(b) ? (x.tier as string) : b), null),
      access_level: null,
      extras: {
        data_updated_at: r.data_updated_at ?? null, metadata_updated_at: r.metadata_updated_at ?? null,
        columns, page_views_total: r.page_views?.page_views_total ?? null, download_count: r.download_count ?? null,
        provenance: r.provenance ?? null, parent: r.parent_fxf?.[0] ?? null, domain_metadata: dm ?? [],
      },
    },
    resources,
    raw: a,
  };
}

export async function* listSocrata(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  const host = new URL(base).host;
  let offset = 0, total = Infinity;
  while (offset < total) {
    const j = await getJson(`${base}/api/catalog/v1?domains=${host}&search_context=${host}&limit=${PAGE}&offset=${offset}&order=dataset_id`);
    total = j.resultSetSize ?? 0;
    opts.onPage?.(offset, total);
    if (!j.results?.length) break;
    yield (j.results as any[]).filter((a) => !a.metadata?.domain || a.metadata.domain === host).map((a) => mapAsset(sourceId, base, a, now));
    offset += j.results.length;
    if (offset < total) await sleep(opts.gapMs ?? 1_000);
  }
}
