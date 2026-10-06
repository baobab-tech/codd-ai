/**
 * ArcGIS Hub catalog listing (Part 1: registry). Pages through the site's OGC search API (`collections/all`)
 * and maps ArcGIS items to dataset/resource rows. Query-time access (FeatureServer /query) belongs to Part 2.
 *
 * One Hub site can show items from several ArcGIS organizations, and several sites can show the same items
 * (the Waterloo region's three sites share one catalogue). Item ids are global, so `harvest:load` dedupes them.
 */
import { UA } from "../../http.js";
import { tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const PAGE = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];

// ArcGIS item type -> normalized format token (tier comes from tierOf).
const TYPE_FORMAT: Record<string, string> = {
  "Feature Service": "ESRI REST", "Map Service": "ESRI REST", "Image Service": "ESRI REST",
  "OGCFeatureServer": "OGC API", "WMS": "WMS", "WFS": "WFS", "WMTS": "WMTS",
  "CSV": "CSV", "CSV Collection": "CSV", "Microsoft Excel": "XLSX", "GeoJson": "GEOJSON",
  "Shapefile": "SHP", "File Geodatabase": "GDB", "KML": "KML", "KML Collection": "KML", "GeoPackage": "GPKG",
  "PDF": "PDF", "Microsoft Word": "DOCX", "Microsoft Powerpoint": "PPTX", "Document Link": "HTML",
  "Vector Tile Service": "VECTOR TILES", "Scene Service": "SCENE", "Image": "IMAGE",
};
const FILE_TYPES = new Set(["CSV", "CSV Collection", "Microsoft Excel", "GeoJson", "Shapefile", "File Geodatabase", "KML", "KML Collection", "GeoPackage", "PDF", "Microsoft Word", "Microsoft Powerpoint", "Image"]);
// Hub generates these from feature layers on request (HTTP 202, then poll).
const HUB_DOWNLOADS: [string, string][] = [["csv", "CSV"], ["geojson", "GEOJSON"], ["shapefile", "SHP"], ["kml", "KML"]];

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.json();
    } catch (e) {
      if (i >= tries || String(e).includes("not retried")) throw e;
      await sleep(5_000 * i * i);
    }
  }
}

const stripHtml = (s: unknown): string | null => {
  if (typeof s !== "string" || !s.trim()) return null;
  const t = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  return t || null;
};
const iso = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);

export function mapItem(sourceId: string, base: string, p: any, now: string): HarvestRecord {
  const id = `${sourceId}|${p.id}`;
  const format = TYPE_FORMAT[p.type] ?? (p.type ? String(p.type).toUpperCase() : null);
  const primaryUrl = p.url || (FILE_TYPES.has(p.type) ? `https://www.arcgis.com/sharing/rest/content/items/${p.id}/data` : `https://www.arcgis.com/home/item.html?id=${p.id}`);
  const resources: Record<string, unknown>[] = [
    { id: `${id}|item`, dataset_id: id, source_id: sourceId, name: p.title ?? null, url: primaryUrl, format, mimetype: null, size: typeof p.size === "number" && p.size >= 0 ? p.size : null, datastore: false, tier: tierOf(format, { url: primaryUrl, name: p.name }), modified: iso(p.modified) },
  ];
  if (p.type === "Feature Service") {
    for (const [slug, fmt] of HUB_DOWNLOADS) {
      const url = `${base}/api/download/v1/items/${p.id}/${slug}?layers=0`;
      resources.push({ id: `${id}|hub-${slug}`, dataset_id: id, source_id: sourceId, name: `Hub download (${fmt}, generated on request)`, url, format: fmt, mimetype: null, size: null, datastore: false, tier: tierOf(fmt, { url }), modified: null });
    }
  }
  const licenceText = stripHtml(p.licenseInfo);
  const licenceUrl = typeof p.licenseInfo === "string" ? (p.licenseInfo.match(/href=['"]([^'"]+)['"]/)?.[1] ?? null) : null;
  const themes = [...new Set((p.categories ?? []).map((c: string) => c.split("/").filter(Boolean)).map((segs: string[]) => {
    const rest = segs[0] === "Categories" ? segs.slice(1) : segs;
    return rest.length > 1 && /open data/i.test(rest[0]) ? rest.slice(1).join(" / ") : rest.join(" / ");
  }).filter((t: string) => t && !/^open data$/i.test(t)))];
  return {
    dataset: {
      id,
      source_id: sourceId,
      native_id: p.id,
      name: p.name ?? null,
      title: p.title ?? null,
      description: (stripHtml(p.description) ?? p.snippet ?? null)?.slice(0, 20_000) ?? null,
      publisher: p.orgId ?? null,                 // ArcGIS organization that owns the item
      publisher_title: null,
      type: p.type ?? null,
      tags: p.tags ?? [],
      licence: licenceText?.slice(0, 500) ?? (p.license && p.license !== "custom" ? p.license : null),
      landing_url: `${base}/datasets/${p.id}`,
      created: iso(p.created),
      modified: iso(p.modified),
      harvested_at: now,
      themes,
      keywords: [],
      frequency: null,
      has_spatial: !!p.extent,
      bilingual: null,                            // not exposed by Hub
      is_open: null,                              // Hub has no open flag; the view reads the licence text
      licence_url: licenceUrl,
      has_contact: null,                          // not exposed comparably by Hub
      resource_count: resources.length,
      formats: [...new Set(resources.map((r) => r.format).filter(Boolean))],
      best_tier: resources.reduce<string | null>((b, r) => (b === null || TIER_RANK.indexOf(r.tier as string) > TIER_RANK.indexOf(b) ? (r.tier as string) : b), null),
      access_level: p.access ?? null,
      extras: { orgId: p.orgId ?? null, owner: p.owner ?? null, numViews: p.numViews ?? null, scoreCompleteness: p.scoreCompleteness ?? null, size: p.size ?? null, culture: p.culture ?? null, typeKeywords: (p.typeKeywords ?? []).slice(0, 12) },
    },
    resources,
    raw: p,
  };
}

// ArcGIS organization id -> name, shared across sites in one run.
const orgNames = new Map<string, Promise<string | null>>();
function orgName(orgId: string | null): Promise<string | null> {
  if (!orgId) return Promise.resolve(null);
  if (!orgNames.has(orgId))
    orgNames.set(orgId, getJson(`https://www.arcgis.com/sharing/rest/portals/${orgId}?f=json`).then((j) => j?.name ?? null).catch(() => null));
  return orgNames.get(orgId)!;
}

export async function* listArcgisHub(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  // Default ordering is unstable across pages (items repeat and others are skipped); created time is stable.
  let url: string | null = `${base}/api/search/v1/collections/all/items?limit=${PAGE}&sortBy=properties.created`;
  let seen = 0;
  while (url) {
    const j = await getJson(url);
    const feats: any[] = j.features ?? [];
    opts.onPage?.(seen, j.numberMatched ?? NaN);
    const recs = feats.map((f) => mapItem(sourceId, base, f.properties ?? {}, now));
    for (const r of recs) r.dataset.publisher_title = await orgName(r.dataset.publisher as string | null);
    yield recs;
    seen += feats.length;
    const next = (j.links ?? []).find((l: any) => l.rel === "next")?.href ?? null;
    url = feats.length && next ? next : null;
    if (url) await sleep(opts.gapMs ?? 1_000);
  }
}
