/**
 * ArcGIS Server (no Hub) catalog listing (Part 1: registry). Walks the REST services directory, restricted to the
 * folders a recipe designates as open data (`folders`) or minus excluded ones (`exclude_folders`): public servers
 * often mix open and internal services. One dataset per layer or table, titled by layer and grouped by service (themes).
 * Without a recipe the source is not harvested.
 */
import { UA } from "../../http.js";
import { tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const QUERYABLE = new Set(["MapServer", "FeatureServer", "ImageServer"]);

async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
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

const GENERIC = /^(map|layers|untitled|default)$|\.(aprx|mxd)$/i;

/** One dataset per layer or table (group layers hold no data); an ImageServer or layerless service is one dataset. */
export function mapService(sourceId: string, root: string, svc: { name: string; type: string }, j: any, recipe: any, now: string): HarvestRecord[] {
  const url = `${root}/${svc.name}/${svc.type}`;
  const svcTitle = [j.documentInfo?.Title, j.mapName].find((t) => t && !GENERIC.test(t)) ?? svc.name.split("/").pop()!.replace(/_/g, " ");
  const parts: any[] = [...(j.layers ?? []), ...(j.tables ?? [])].filter((l: any) => !l.subLayerIds?.length);
  const units = parts.length ? parts : [{ id: null, name: svcTitle }];
  const description = (stripHtml(j.serviceDescription) ?? stripHtml(j.description) ?? stripHtml(j.documentInfo?.Subject))?.slice(0, 20_000) ?? null;
  return units.map((l) => {
    const native = l.id == null ? `${svc.name}/${svc.type}` : `${svc.name}/${svc.type}/${l.id}`;
    const id = `${sourceId}|${native}`;
    const u = l.id == null ? url : `${url}/${l.id}`;
    const resources = [{ id: `${id}|layer`, dataset_id: id, source_id: sourceId, name: l.name ?? null, url: u, format: "ESRI REST", mimetype: null, size: null, datastore: false, tier: tierOf("ESRI REST", { url: u }), modified: null }];
    return {
      dataset: {
        id, source_id: sourceId, native_id: native, name: native, title: l.name ?? svcTitle, description,
        publisher: j.documentInfo?.Author || null, publisher_title: null, type: l.type ?? svc.type,
        tags: (j.documentInfo?.Keywords ?? "").split(/[,;]/).map((t: string) => t.trim()).filter(Boolean),
        licence: recipe?.licence ?? (stripHtml(j.copyrightText)?.slice(0, 500) || null),
        landing_url: u, created: null, modified: null, harvested_at: now, themes: [svcTitle],
        keywords: [], frequency: null, has_spatial: l.type !== "Table" && !!(j.fullExtent || j.initialExtent || j.extent), bilingual: null, is_open: null,
        licence_url: recipe?.licence_url ?? null, has_contact: false, resource_count: 1, formats: ["ESRI REST"],
        best_tier: "live_query", access_level: null,
        extras: { service: `${svc.name}/${svc.type}`, service_title: svcTitle, layer_id: l.id, max_record_count: j.maxRecordCount ?? null, capabilities: j.capabilities ?? null, copyright: stripHtml(j.copyrightText) },
      },
      resources,
      raw: { service: svc, layer: l, service_json: l === units[0] ? j : undefined },
    };
  });
}

export async function* listArcgisServer(sourceId: string, base: string, opts: { gapMs?: number; recipe?: any; onPage?: (start: number, total: number) => void } = {}) {
  const recipe = opts.recipe ?? {};
  if (!recipe.folders && !recipe.exclude_folders) throw new Error("no folders in recipe: which services are open data must be decided first (not retried)");
  const root = (recipe.services_root ?? base).replace(/\/+$/, "");
  const gap = Math.max(opts.gapMs ?? 1_000, (recipe.crawl_delay_s ?? 0) * 1000);
  const now = new Date().toISOString();
  const top = await getJson(`${root}?f=json`);
  await sleep(gap);
  const folders: string[] = recipe.folders ?? (top.folders ?? []).filter((f: string) => !recipe.exclude_folders.includes(f));
  const services: { name: string; type: string }[] = recipe.folders ? [] : (top.services ?? []); // root services count only when excluding
  for (const f of folders) {
    const j = await getJson(`${root}/${f}?f=json`);
    services.push(...(j.services ?? []));
    await sleep(gap);
  }
  const svcs = services.filter((s) => QUERYABLE.has(s.type));
  let n = 0;
  for (const s of svcs) {
    opts.onPage?.(n, svcs.length);
    try {
      const j = await getJson(`${root}/${s.name}/${s.type}?f=json`);
      if (!j.error) yield mapService(sourceId, root, s, j, recipe, now);
    } catch { /* a stopped or secured service: skip it */ }
    n++;
    await sleep(gap);
  }
}
