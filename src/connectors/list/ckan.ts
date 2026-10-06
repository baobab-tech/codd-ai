/**
 * CKAN catalog listing (Part 1: registry). Pages through package_search and maps packages to dataset/resource rows.
 * Query-time access (DataStore) belongs to Part 2 and lives elsewhere.
 */
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";

const PAGE = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(180_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.json();
    } catch (e) {
      if (i >= tries || String(e).includes("not retried")) throw e;
      await sleep(5_000 * i * i);
    }
  }
}

const str = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "object") {
    const o = v as Record<string, string>;
    return o.en ?? o.fr ?? Object.values(o)[0] ?? null; // CKAN fluent fields: {"en": ..., "fr": ...}
  }
  return String(v);
};

export interface HarvestRecord {
  dataset: Record<string, unknown>;
  resources: Record<string, unknown>[];
  raw: unknown; // the platform's full record, kept so later analysis can re-derive fields without refetching
}

const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];
const list = (v: unknown): string[] => {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v.flatMap(list);
  if (typeof v === "object") return Object.values(v as object).flatMap(list); // fluent {en:[...], fr:[...]}
  return String(v).split(/\s*[,;]\s*/).filter(Boolean);
};

export function mapPackage(sourceId: string, base: string, p: any, now: string): HarvestRecord {
  const id = `${sourceId}|${p.id}`;
  const resources = (p.resources ?? []).map((r: any, i: number) => {
    const format = normalizeFormat(r.format, r.url);
    return {
      id: `${id}|${r.id ?? i}`,
      dataset_id: id,
      source_id: sourceId,
      name: str(r.name_translated) ?? str(r.name),
      url: r.url ?? null,
      format,
      mimetype: r.mimetype ?? null,
      size: Number.isFinite(Number(r.size)) && r.size !== null && r.size !== "" ? Number(r.size) : null,
      datastore: r.datastore_active === true,
      tier: tierOf(format, { datastore: r.datastore_active === true, url: r.url, name: str(r.name) }),
      modified: r.last_modified ?? r.metadata_modified ?? null,
    };
  });
  const tt = p.title_translated;
  const themes = [...new Set([
    ...(p.groups ?? []).map((g: any) => str(g.display_name) ?? str(g.title) ?? g.name),
    ...list(p.subject), ...list(p.topic_category), ...list(p.category), ...list(p.theme),
  ].filter(Boolean))];
  return {
    dataset: {
      id,
      source_id: sourceId,
      native_id: p.id,
      name: p.name ?? null,
      title: str(tt) ?? str(p.title),
      description: (str(p.notes_translated) ?? str(p.notes))?.slice(0, 20_000) ?? null,
      publisher: p.organization?.name ?? null,
      publisher_title: str(p.organization?.title_translated) ?? str(p.organization?.title),
      type: p.type ?? null,
      tags: (p.tags ?? []).map((t: any) => t.display_name ?? t.name).filter(Boolean),
      licence: p.license_title ?? p.license_id ?? null,
      landing_url: p.name ? `${base}/dataset/${p.name}` : null,
      created: p.metadata_created ?? null,
      modified: p.metadata_modified ?? null,
      harvested_at: now,
      themes,
      keywords: [...new Set(list(p.keywords))].slice(0, 100),
      frequency: str(p.frequency) ?? str(p.update_frequency) ?? str(p.accrual_periodicity) ?? null,
      has_spatial: !!(p.spatial || p.geographic_coverage_translated || p.geographic_coverage || p.geographic_region),
      bilingual: !!(tt && typeof tt === "object" && tt.en && tt.fr),
      is_open: typeof p.isopen === "boolean" ? p.isopen : null,
      licence_url: p.license_url ?? null,
      has_contact: !!(p.maintainer_email || p.author_email || p.maintainer || p.author),
      resource_count: resources.length,
      formats: [...new Set(resources.map((r: any) => r.format).filter(Boolean))],
      best_tier: resources.reduce((b: string | null, r: any) => (b === null || TIER_RANK.indexOf(r.tier) > TIER_RANK.indexOf(b) ? r.tier : b), null),
      access_level: str(p.access_level) ?? null,
    },
    resources,
    raw: p,
  };
}

/** Yields one page of mapped records at a time. `gapMs` spaces requests to the portal. */
export async function* listCkan(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const url = `${base}/api/3/action/package_search?rows=${PAGE}&start=${start}&sort=id%20asc`;
    const j = await getJson(url);
    if (!j?.success) throw new Error(`package_search failed at start=${start}`);
    total = j.result.count;
    const rows: any[] = j.result.results ?? [];
    opts.onPage?.(start, total);
    yield rows.map((p) => mapPackage(sourceId, base, p, now));
    if (!rows.length) break;
    start += rows.length;
    await sleep(opts.gapMs ?? 1_000);
  }
}
