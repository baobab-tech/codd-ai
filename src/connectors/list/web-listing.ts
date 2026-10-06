/**
 * Web listing (Part 1: registry): pages that link data files, driven by each source's recipe.
 *   start_urls       pages to read
 *   depth            1 = also read same-site pages linked from them (dataset_pages / theme_pages hints, else same path)
 *   extensions       file extensions to collect (default: common data and document formats)
 *   include          regexes a file URL must match (absolute, or path when it starts with ^/)
 *   file_hosts       hosts files must live on
 *   extra_urls       known file URLs to add (links the pages hide)
 *   licence, licence_url, crawl_delay_s
 * Links are read from <a href> and from absolute URLs anywhere in the page text, which catches links held in
 * embedded JSON (Metrolinx's __NEXT_DATA__). Windows backslashes in links are normalized (Whitehorse).
 * Files that differ only by format are grouped into one record with one resource each. Sources marked fetch: "browser" are skipped until a browser fetcher exists.
 */
import * as cheerio from "cheerio";
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_EXT = ["csv", "xlsx", "xls", "json", "geojson", "xml", "zip", "kml", "kmz", "shp", "gdb", "gpkg", "pdf", "txt", "tsv", "ods", "dwg"];
const MAX_PAGES = 400;

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" }, signal: AbortSignal.timeout(60_000), redirect: "follow" });
    if (!res.ok || !/html|text/.test(res.headers.get("content-type") ?? "")) return null;
    return await res.text();
  } catch { return null; }
}

function links(html: string, pageUrl: string, scanText: boolean): { url: string; text: string | null }[] {
  const $ = cheerio.load(html);
  const out: { url: string; text: string | null }[] = [];
  const add = (href: string | undefined, text: string | null) => {
    if (!href || /^(mailto|javascript|tel):/i.test(href)) return;
    try { out.push({ url: new URL(href.trim().replace(/\\/g, "/"), pageUrl).toString(), text }); } catch { /* bad href */ }
  };
  $("a[href]").each((_, a) => add($(a).attr("href"), $(a).text().replace(/\s+/g, " ").trim() || null));
  // URLs held in scripts or embedded JSON (Metrolinx's __NEXT_DATA__), only when the recipe says so: raw-text scanning picks up escaped HTML otherwise.
  if (scanText) for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)&]+/g)) add(m[0], null);
  return out;
}

const extOf = (u: string) => new URL(u).pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? null;

export async function* listWebListing(sourceId: string, base: string, opts: { gapMs?: number; recipe?: any; onPage?: (start: number, total: number) => void } = {}) {
  const r = opts.recipe ?? {};
  if (String(r.fetch ?? "").startsWith("browser")) throw new Error("needs a browser fetcher (not retried)");
  const now = new Date().toISOString();
  const gap = Math.max(opts.gapMs ?? 1_000, (r.crawl_delay_s ?? 0) * 1000);
  const extList = Array.isArray(r.extensions) ? r.extensions : Array.isArray(r.collect) ? r.collect : DEFAULT_EXT;
  const exts = new Set<string>(extList.map((e: string) => e.toLowerCase().replace(/^\./, "")));
  // Patterns starting with ^/ match the URL path; others the full URL. (RegExp.source escapes "/", so keep the flag.)
  const include = (r.include ?? []).map((s: string) => ({ re: new RegExp(s, "i"), path: s.startsWith("^/") }));
  const start: string[] = r.start_urls ?? [base];
  const startHost = new URL(start[0]).host;
  const pages = [...start];
  const seenPages = new Set(pages);
  const files = new Map<string, { url: string; text: string | null; page: string }>();
  for (let i = 0; i < pages.length && i < MAX_PAGES; i++) {
    const page = pages[i];
    opts.onPage?.(i, pages.length);
    const html = await getText(page);
    await sleep(gap);
    if (!html) continue;
    for (const l of links(html, page, !!r.parse)) {
      let u: URL;
      try { u = new URL(l.url); } catch { continue; }
      const ext = extOf(l.url);
      const pathMatch = ext !== null && (include.length ? include.some((p: { re: RegExp; path: boolean }) => p.re.test(p.path ? decodeURI(u.pathname) : l.url)) : exts.has(ext));
      const hostOk = !r.file_hosts || r.file_hosts.some((h: string) => (u.host + u.pathname).startsWith(h.replace(/^https?:\/\//, "")));
      if (pathMatch && hostOk) {
        const prev = files.get(l.url);
        if (!prev || (!prev.text && l.text)) files.set(l.url, { url: l.url, text: l.text ?? prev?.text ?? null, page });
        continue;
      }
      // Depth 1: follow same-site HTML pages from the start pages only.
      if ((r.depth ?? 0) >= 1 && start.includes(page) && u.host === startHost && !ext?.match(/^(jpg|png|gif|svg|css|js|ico)$/)) {
        const hint = [r.dataset_pages, ...(r.theme_pages ?? [])].filter(Boolean).map(String);
        const sameSection = u.pathname.startsWith(new URL(page).pathname.replace(/[^/]*$/, ""));
        const hinted = hint.some((h) => l.url.includes(h.replace(/<[^>]+>.*$/, "").replace(/^https?:\/\/[^/]+/, "")) || u.pathname.includes(`/${h}`));
        const key = u.toString().replace(/#.*$/, "");
        if ((hinted || sameSection) && !seenPages.has(key)) (seenPages.add(key), pages.push(key));
      }
    }
  }
  // Known files the pages don't expose as plain links (recipe.extra_urls: [url] or [{url, title}]).
  for (const x of r.extra_urls ?? []) {
    const url = typeof x === "string" ? x : x.url;
    if (!files.has(url)) files.set(url, { url, text: typeof x === "string" ? null : x.title ?? null, page: start[0] });
  }
  // Group the same layer or table offered in several formats (Whitehorse: SHP, DWG, KML) into one dataset.
  const FMT = /(^|[\s._-])(shp|shape|shapefile|dwg|dxf|kml|kmz|csv|xlsx?|gdb|fgdb|zip|geojson|json|pdf|tab|ecw|sid|gpkg)(?=$|[\s._-])/gi;
  const stem = (u: string) => decodeURIComponent(new URL(u).pathname.split("/").pop() ?? u).toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(FMT, "$1").replace(/(?<=[a-z]{3})(csv|dwg|shp|kml|kmz|fgdb|gdb|geojson|metadata)$/, "").replace(/[\s._-]+/g, " ").trim(); // Saanich: AddressCSV.zip, AddressDWG.zip
  const LINKWORD = /^(read more|more|download|csv|xlsx?|excel|pdf|zip|shp|dwg|kml|kmz|gdb|fgdb|geojson|json|here|link|view( the)? metadata|metadata|data)$/i;
  const groups = new Map<string, (typeof files extends Map<string, infer V> ? V : never)[]>();
  for (const f of files.values()) {
    const key = `${f.page}|${stem(f.url) || f.url}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const TIER_RANK = ["link_only", "document", "geo_file", "tabular_file", "live_query"];
  const out: HarvestRecord[] = [...groups.entries()].map(([key, fs]) => {
    const native = fs.length === 1 ? fs[0].url : key;
    const id = `${sourceId}|${native}`;
    const fname = (u: string) => decodeURIComponent(new URL(u).pathname.split("/").pop() ?? u);
    const named = fs.map((f) => f.text).find((t) => t && t.length > 2 && !LINKWORD.test(t));
    const title = named ?? (stem(fs[0].url) || fname(fs[0].url)).replace(/\b\w/g, (c) => c.toUpperCase());
    const resources = fs.map((f, i) => {
      const format = normalizeFormat(null, f.url);
      return { id: `${id}|${i}`, dataset_id: id, source_id: sourceId, name: fname(f.url), url: f.url, format, mimetype: null, size: null, datastore: false, tier: tierOf(format, { url: f.url, name: fname(f.url) }), modified: null };
    });
    return {
      dataset: {
        id, source_id: sourceId, native_id: native, name: stem(fs[0].url) || fname(fs[0].url), title: title.slice(0, 300), description: null, publisher: null, publisher_title: null,
        type: "file", tags: [], licence: r.licence ?? null, landing_url: fs[0].page, created: null, modified: null, harvested_at: now, themes: [],
        keywords: [], frequency: null, has_spatial: null, bilingual: null, is_open: null, licence_url: r.licence_url ?? null, has_contact: null,
        resource_count: resources.length, formats: [...new Set(resources.map((x) => x.format).filter(Boolean))],
        best_tier: resources.reduce<string | null>((b, x) => (b === null || TIER_RANK.indexOf(x.tier) > TIER_RANK.indexOf(b) ? x.tier : b), null),
        access_level: r.licence_class === "restricted" ? "restricted" : null,
        extras: { page: fs[0].page, link_texts: fs.map((f) => f.text).filter(Boolean).slice(0, 5) },
      },
      resources,
      raw: fs,
    };
  });
  for (let i = 0; i < out.length; i += 500) yield out.slice(i, i + 500);
}
