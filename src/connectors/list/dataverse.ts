/**
 * Dataverse catalog listing (Part 1: registry), through the Search API only:
 *   1. licence per dataset, from one filtered query per value of the `license` facet (search results omit it);
 *   2. every published file (format, size, restricted flag, rows and columns for ingested tables) -> resources;
 *   3. every published dataset -> datasets.
 * About 650 requests for Borealis's 25k datasets and 590k files, instead of one export call per dataset.
 * robots.txt on Dataverse hosts disallows /api; the project uses documented APIs anyway (decision 2026-10-06).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../db.js";
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const PAGE = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];

async function getJson(url: string, tries = 7): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(180_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      // A WAF block comes back as an HTML page with status 200 (Abacus at UBC). Stop; retrying makes it worse.
      if (!/json/.test(res.headers.get("content-type") ?? "")) throw new Error(`blocked: ${res.headers.get("content-type")} instead of JSON (not retried)`);
      return await res.json();
    } catch (e) {
      if (i >= tries || String(e).includes("not retried")) throw e;
      await sleep(Math.min(5_000 * i * i, 180_000)); // network blips on long runs: back off up to 3 min
    }
  }
}

// Content type -> format token. Ingested tables are served as tab-delimited.
const CT: Record<string, string> = {
  "text/tab-separated-values": "TSV", "text/csv": "CSV", "text/comma-separated-values": "CSV", "application/pdf": "PDF",
  "application/zip": "ZIP", "application/zipped-shapefile": "SHP", "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX", "application/json": "JSON", "text/plain": "TXT",
  "application/x-spss-sav": "SAV", "application/x-spss-syntax": "SPS", "application/x-spss-por": "POR", "application/x-stata": "DTA",
  "application/x-stata-13": "DTA", "application/x-stata-14": "DTA", "application/x-stata-15": "DTA", "application/x-sas-transport": "XPT",
  "application/x-sas-data": "SAS7BDAT", "application/x-rlang-transport": "RDATA", "application/x-netcdf": "NETCDF", "application/x-hdf5": "HDF5",
  "application/vnd.google-earth.kml+xml": "KML", "application/vnd.google-earth.kmz": "KMZ", "image/tiff": "TIFF", "application/geo+json": "GEOJSON",
  "application/msword": "DOC", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX", "text/html": "HTML", "text/xml": "XML", "application/xml": "XML",
};
const fmtOf = (ct: string | undefined, name: string | undefined) =>
  ct && CT[ct] ? CT[ct] : ct?.startsWith("image/") ? "IMAGE" : normalizeFormat(null, name ?? null);

interface FileRow { id: string; name: string; url: string; format: string | null; size: number | null; restricted: boolean; variables: number | null; observations: number | null; published: string | null }

// Pages are cached on disk (data/harvest/cache/<host>/) so a failed run resumes where it stopped.
async function cachedJson(url: string, gapMs: number): Promise<{ j: any; cached: boolean }> {
  const dir = join(ROOT, "data/harvest/cache", new URL(url).host);
  const file = join(dir, url.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 200) + ".json");
  if (existsSync(file)) return { j: JSON.parse(readFileSync(file, "utf8")), cached: true };
  const j = await getJson(url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(j));
  await sleep(gapMs);
  return { j, cached: false };
}

async function pageAll(base: string, q: string, onPage?: (start: number, total: number) => void, gapMs = 1_000) {
  const out: any[] = [];
  let start = 0, total = Infinity;
  while (start < total) {
    const { j } = await cachedJson(`${base}/api/search?q=*&${q}&per_page=${PAGE}&start=${start}&sort=date&order=asc`, gapMs);
    total = j.data?.total_count ?? 0;
    const items: any[] = j.data?.items ?? [];
    onPage?.(start, total);
    if (!items.length) break;
    out.push(...items);
    start += items.length;
  }
  return out;
}

export function mapDataverse(sourceId: string, base: string, d: any, files: FileRow[], licence: string | null, now: string): HarvestRecord {
  const id = `${sourceId}|${d.global_id}`;
  const resources = files.map((f) => ({
    id: `${id}|${f.id}`, dataset_id: id, source_id: sourceId, name: f.name, url: f.url, format: f.format, mimetype: null, size: f.size,
    datastore: false, tier: tierOf(f.format, { url: f.url, name: f.name }), modified: f.published,
  }));
  const restricted = files.filter((f) => f.restricted).length;
  const tables = files.filter((f) => f.variables != null).slice(0, 25).map((f) => ({ file_id: f.id, name: f.name, variables: f.variables, observations: f.observations }));
  return {
    dataset: {
      id,
      source_id: sourceId,
      native_id: d.global_id,
      name: d.global_id,
      title: d.name ?? null,
      description: d.description?.slice(0, 20_000) || null,
      publisher: d.identifier_of_dataverse ?? null,
      publisher_title: d.name_of_dataverse ?? null,
      type: d.type ?? "dataset",
      tags: [],
      licence,
      landing_url: d.url ?? `${base}/dataset.xhtml?persistentId=${d.global_id}`,
      created: d.createdAt ?? d.published_at ?? null,
      modified: d.updatedAt ?? null,
      harvested_at: now,
      themes: d.subjects ?? [],
      keywords: d.keywords ?? [],
      frequency: null,
      has_spatial: null,
      bilingual: null,
      is_open: null,
      licence_url: null,
      has_contact: !!(d.contacts?.length),
      resource_count: resources.length,
      formats: [...new Set(resources.map((r) => r.format).filter(Boolean))],
      // Restricted files need a request to the depositor; only open files count toward the best tier.
      best_tier: resources.filter((_, i) => !files[i].restricted).reduce<string | null>((b, r) => (b === null || TIER_RANK.indexOf(r.tier) > TIER_RANK.indexOf(b) ? r.tier : b), null),
      access_level: files.length && restricted === files.length ? "restricted" : restricted ? "partly_restricted" : null,
      extras: { doi: d.global_id, citation: d.citation ?? null, authors: d.authors ?? [], file_count: d.fileCount ?? files.length, restricted_files: restricted, tables, version: d.majorVersion != null ? `${d.majorVersion}.${d.minorVersion}` : null },
    },
    resources,
    raw: d,
  };
}

export async function* listDataverse(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  const gap = opts.gapMs ?? 3_000; // gentle: UBC's Abacus blocked after ~37 one-second-spaced pages of 1,000
  // 1. Licences, through the facet.
  const f = await getJson(`${base}/api/search?q=*&type=dataset&per_page=1&show_facets=true`);
  const labels: string[] = (f.data?.facets ?? []).flatMap((x: any) => (x.license ? x.license.labels.map((l: any) => Object.keys(l)[0]) : []));
  const licence = new Map<string, string>();
  for (const l of labels) {
    for (const d of await pageAll(base, `type=dataset&fq=license:${encodeURIComponent(`"${l}"`)}`, undefined, gap)) licence.set(d.global_id, l);
  }
  // 2. Files, grouped by dataset.
  const files = new Map<string, FileRow[]>();
  for (const x of await pageAll(base, "type=file", (s, t) => opts.onPage?.(s, t), gap)) {
    const row: FileRow = { id: x.file_id, name: x.name, url: x.url, format: fmtOf(x.file_content_type, x.name), size: x.size_in_bytes ?? null,
      restricted: !!x.restricted, variables: x.variables ?? null, observations: x.observations ?? null, published: x.published_at ?? null };
    const k = x.dataset_persistent_id;
    if (!files.has(k)) files.set(k, []);
    files.get(k)!.push(row);
  }
  // 3. Datasets.
  const datasets = await pageAll(base, "type=dataset", undefined, gap);
  for (let i = 0; i < datasets.length; i += PAGE)
    yield datasets.slice(i, i + PAGE).map((d) => mapDataverse(sourceId, base, d, files.get(d.global_id) ?? [], licence.get(d.global_id) ?? null, now));
}
