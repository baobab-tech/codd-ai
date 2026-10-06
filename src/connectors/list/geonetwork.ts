/**
 * GeoNetwork 4 catalog listing (Part 1: registry), through its Elasticsearch search endpoint
 * (`/srv/api/search/records/_search`), which returns the indexed ISO 19139 record as JSON. Links become
 * resources, typed by protocol (OGC services, Esri REST, downloads).
 */
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const PAGE = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];

async function search(api: string, from: number, tries = 4): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${api}/search/records/_search`, {
        method: "POST",
        headers: { "user-agent": UA, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ from, size: PAGE, track_total_hits: true, query: { match_all: {} }, sort: [{ uuid: "asc" }] }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.json();
    } catch (e) {
      if (i >= tries || String(e).includes("not retried")) throw e;
      await sleep(5_000 * i * i);
    }
  }
}

const txt = (o: any): string | null => (o == null ? null : typeof o === "string" ? o : o.default ?? o.langeng ?? Object.values(o)[0] ?? null) as string | null;
const txts = (v: any): string[] => (Array.isArray(v) ? v : v ? [v] : []).map(txt).filter((x): x is string => !!x);

function linkFormat(l: any): string | null {
  const p = String(l.protocol ?? "").toUpperCase();
  const url = txt(l.urlObject) ?? "";
  if (p.includes("WMS")) return "WMS";
  if (p.includes("WFS")) return "WFS";
  if (p.includes("WMTS")) return "WMTS";
  if (p.includes("ESRI") || /\/(MapServer|FeatureServer|ImageServer)/i.test(url)) return "ESRI REST";
  if (p.includes("OGC API") || p.includes("OGC:API")) return "OGC API";
  return normalizeFormat(l.mimeType || null, url);
}

export function mapGn(sourceId: string, base: string, s: any, now: string): HarvestRecord {
  const uuid = s.metadataIdentifier ?? s.uuid;
  const id = `${sourceId}|${uuid}`;
  const links: any[] = Array.isArray(s.link) ? s.link : s.link ? [s.link] : [];
  const resources = links.filter((l) => txt(l.urlObject)).map((l, i) => {
    const url = txt(l.urlObject)!;
    const format = linkFormat(l);
    const name = txt(l.nameObject) ?? txt(l.descriptionObject) ?? l.protocol ?? null;
    return { id: `${id}|${i}`, dataset_id: id, source_id: sourceId, name, url, format, mimetype: l.mimeType || null, size: null, datastore: false, tier: tierOf(format, { url, name }), modified: null };
  });
  const licence = txt(s.licenseObject?.[0] ?? s.licenseObject) ?? txts(s.MD_LegalConstraintsOtherConstraintsObject)[0] ?? txts(s.MD_LegalConstraintsUseLimitationObject)[0] ?? null;
  return {
    dataset: {
      id,
      source_id: sourceId,
      native_id: uuid,
      name: uuid,
      title: txt(s.resourceTitleObject),
      description: txt(s.resourceAbstractObject)?.slice(0, 20_000) ?? null,
      publisher: txt(s.OrgForResourceObject?.[0] ?? s.OrgForResourceObject) ?? txt(s.contactForResource?.[0]?.organisationObject) ?? null,
      publisher_title: txt(s.OrgForResourceObject?.[0] ?? s.OrgForResourceObject) ?? null,
      type: (s.resourceType ?? [])[0] ?? null,
      tags: txts(s.tag),
      licence: licence?.slice(0, 500) ?? null,
      landing_url: `${base}/srv/eng/catalog.search#/metadata/${uuid}`,
      created: s.createDate ?? null,
      modified: s.dateStamp ?? s.changeDate ?? null,
      harvested_at: now,
      themes: (s.cl_topic ?? []).map((t: any) => txt(t)).filter(Boolean),
      keywords: [],
      frequency: txt(s.cl_maintenanceAndUpdateFrequency?.[0]) ?? null,
      has_spatial: !!(s.geom || s.location),
      bilingual: null,
      is_open: typeof s.isOpenData === "string" ? s.isOpenData === "true" : typeof s.isOpenData === "boolean" ? s.isOpenData : null,
      licence_url: null,
      has_contact: !!(s.contactForResource?.length || s.contact?.length),
      resource_count: resources.length,
      formats: [...new Set([...resources.map((r) => r.format), ...(s.format ?? []).map((f: string) => normalizeFormat(f))].filter(Boolean))],
      best_tier: resources.reduce<string | null>((b, r) => (b === null || TIER_RANK.indexOf(r.tier) > TIER_RANK.indexOf(b) ? r.tier : b), null),
      access_level: null,
      extras: { formats_declared: s.format ?? [], temporal: s.resourceTemporalDateRange ?? null, harvested_from: s.isHarvested === "true" ? s.sourceCatalogue ?? null : null },
    },
    resources,
    raw: s,
  };
}

export async function* listGeonetwork(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  const api = `${base}/srv/api`;
  let from = 0, total = Infinity;
  while (from < total) {
    const j = await search(api, from);
    total = j.hits?.total?.value ?? 0;
    const hits: any[] = j.hits?.hits ?? [];
    opts.onPage?.(from, total);
    if (!hits.length) break;
    yield hits.map((h) => h._source).filter((s) => s.docType === "metadata" && s.isTemplate === "n").map((s) => mapGn(sourceId, base, s, now));
    from += hits.length;
    if (from < total) await sleep(opts.gapMs ?? 1_000);
  }
}
