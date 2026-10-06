/**
 * GeoCore (geo.ca) listing (Part 1: registry): the federal geospatial meta-catalogue, paged through its keyword
 * search (min/max row numbers). Most records share ids with open.canada.ca; the source's recipe sets
 * `mirrors: ckan:open.canada.ca/data`, so harvest:load marks those as duplicates and only the rest count.
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

// GeoCore serializes nested JSON with doubled quotes.
const parse = (s: unknown): any => {
  if (typeof s !== "string" || !s.trim()) return null;
  try { return JSON.parse(s.replace(/""/g, '"')); } catch { return null; }
};
const en = (v: any) => (v && typeof v === "object" ? v.en ?? v.fr ?? null : v ?? null);

function linkFormat(o: any): string | null {
  const p = String(o.protocol ?? "").toUpperCase();
  const desc = String(en(o.description) ?? ""); // "type;format;lang", e.g. "Web Service;ESRI REST;eng"
  const fmt = desc.split(";")[1]?.trim();
  if (p.includes("WMS") || /WMS/i.test(fmt ?? "")) return "WMS";
  if (/ESRI REST/i.test(p + fmt) || /\/(MapServer|FeatureServer)/i.test(o.url ?? "")) return "ESRI REST";
  if (fmt && !/unknown/i.test(fmt)) return normalizeFormat(fmt, o.url);
  return normalizeFormat(null, o.url);
}

export function mapGeocore(sourceId: string, x: any, now: string): HarvestRecord {
  const id = `${sourceId}|${x.id}`;
  const links: any[] = parse(x.options) ?? [];
  const resources = links.filter((o) => o.url).map((o, i) => {
    const format = linkFormat(o);
    const name = en(o.name);
    return { id: `${id}|${i}`, dataset_id: id, source_id: sourceId, name, url: o.url, format, mimetype: null, size: null, datastore: false, tier: tierOf(format, { url: o.url, name }), modified: null };
  });
  const org = String(x.organisation ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  return {
    dataset: {
      id, source_id: sourceId, native_id: x.id, name: x.id, title: x.title?.trim() || null, description: x.description?.slice(0, 20_000) || null,
      publisher: org.at(-1) ?? null, publisher_title: org.at(-1) ?? null, type: String(x.type ?? "").split(";")[0].trim() || null,
      tags: String(x.keywords ?? "").split(",").map((s) => s.trim()).filter(Boolean), licence: null,
      landing_url: `https://app.geo.ca/en-ca/map-browser/record/${x.id}`, created: x.created && x.created !== "N/A" ? x.created : null,
      modified: x.published && x.published !== "N/A" ? x.published : null, harvested_at: now, themes: x.topicCategory ? [x.topicCategory] : [],
      keywords: [], frequency: null, has_spatial: !!x.coordinates, bilingual: null, is_open: null, licence_url: null, has_contact: !!parse(x.contact)?.length,
      resource_count: resources.length, formats: [...new Set(resources.map((r) => r.format).filter(Boolean))],
      best_tier: resources.reduce<string | null>((b, r) => (b === null || TIER_RANK.indexOf(r.tier) > TIER_RANK.indexOf(b) ? r.tier : b), null),
      access_level: null, extras: { organisation: org, temporal: x.temporalExtent ?? null, popularity: x.popularity ?? null },
    },
    resources,
    raw: x,
  };
}

export async function* listGeocore(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  let min = 1, total = Infinity;
  while (min <= total) {
    const j = await getJson(`${base}/geo?keyword_only=true&lang=en&keyword=&min=${min}&max=${min + PAGE - 1}`);
    const items: any[] = j.Items ?? [];
    total = Number(items[0]?.total ?? 0);
    opts.onPage?.(min - 1, total);
    if (!items.length) break;
    yield items.map((x) => mapGeocore(sourceId, x, now));
    min += PAGE;
    if (min <= total) await sleep(opts.gapMs ?? 1_000);
  }
}
