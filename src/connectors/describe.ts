/**
 * Describe a live-queryable resource (Part 1: registry enrichment): its columns, row count, a few sample rows
 * and query limits, so agents can write a correct query without probing first. Reads only; no bulk download.
 */
import { UA } from "../http.js";

export interface Described {
  key: string;
  kind: "ckan_datastore" | "esri";
  url: string;
  schema: { name: string; type: string; alias?: string }[] | null;
  row_count: number | null;
  sample: Record<string, unknown>[] | null;
  data_modified: string | null;
  query_caps: Record<string, unknown> | null;
  error: string | null;
  described_at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON, one retry on 429/5xx. Returns {json} or {error}. */
async function getJson(url: string): Promise<{ json?: any; error?: string }> {
  for (let i = 1; i <= 2; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      if ((res.status === 429 || res.status >= 500) && i < 2) { await sleep(5_000); continue; }
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const text = await res.text();
      try { return { json: JSON.parse(text) }; } catch { return { error: `not JSON (${res.headers.get("content-type") ?? "?"})` }; }
    } catch (e) {
      if (i < 2) { await sleep(5_000); continue; }
      return { error: String((e as Error).name === "TimeoutError" ? "timeout" : (e as any).cause?.code ?? (e as Error).message) };
    }
  }
  return { error: "unreachable" };
}

// Keep samples small: long strings cut, nested values dropped.
function trimRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "_id" || k === "_full_text") continue;
    out[k] = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v !== null && typeof v === "object" ? "[object]" : v;
  }
  return out;
}

export async function describeDatastore(key: string, base: string, resourceId: string, gap: () => Promise<void>): Promise<Described> {
  const url = `${base}/api/3/action/datastore_search?resource_id=${encodeURIComponent(resourceId)}&limit=3`;
  const r = await getJson(url);
  await gap();
  const res = r.json?.success ? r.json.result : null;
  return {
    key, kind: "ckan_datastore", url,
    schema: res ? (res.fields ?? []).filter((f: any) => f.id !== "_id" && f.id !== "_full_text").map((f: any) => ({ name: f.id, type: f.type })) : null,
    row_count: typeof res?.total === "number" ? res.total : null,
    sample: res ? (res.records ?? []).map(trimRow) : null,
    data_modified: null, // DataStore exposes no edit time; resources.modified has the portal's resource date
    query_caps: res ? { kind: "ckan_datastore", sql: null } : null,
    error: res ? null : (r.error ?? r.json?.error?.message ?? "no result"),
    described_at: new Date().toISOString(),
  };
}

const esriError = (j: any) => (j?.error ? `${j.error.code ?? ""} ${j.error.message ?? ""}`.trim() : null);

/** Esri FeatureServer/MapServer: a service root is described through its first layer; other layers are listed. */
export async function describeEsri(key: string, url: string, gap: () => Promise<void>): Promise<Described> {
  const base: Described = { key, kind: "esri", url, schema: null, row_count: null, sample: null, data_modified: null, query_caps: null, error: null, described_at: new Date().toISOString() };
  const clean = url.replace(/\/+$/, "").replace(/\?.*$/, "");
  let layerUrl = clean;
  let layers: { id: number; name: string; type?: string }[] | null = null;
  if (!/\/\d+$/.test(clean)) {
    const s = await getJson(`${clean}?f=json`);
    await gap();
    if (!s.json || esriError(s.json)) return { ...base, error: s.error ?? esriError(s.json) };
    layers = [...(s.json.layers ?? []), ...(s.json.tables ?? [])].map((l: any) => ({ id: l.id, name: l.name, type: l.type }));
    if (!layers.length) return { ...base, query_caps: { layers: [] }, error: "no layers" };
    layerUrl = `${clean}/${layers[0].id}`;
  }
  const l = await getJson(`${layerUrl}?f=json`);
  await gap();
  if (!l.json || esriError(l.json)) return { ...base, query_caps: layers ? { layers } : null, error: l.error ?? esriError(l.json) };
  const L = l.json;
  const canQuery = /query/i.test(L.capabilities ?? "Query");
  let sample: Record<string, unknown>[] | null = null, count: number | null = null, qerr: string | null = null;
  if (canQuery) {
    const q = await getJson(`${layerUrl}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3&f=json`);
    await gap();
    if (q.json && !esriError(q.json)) sample = (q.json.features ?? []).slice(0, 3).map((f: any) => trimRow(f.attributes ?? {}));
    else qerr = q.error ?? esriError(q.json);
    const c = await getJson(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
    await gap();
    if (typeof c.json?.count === "number") count = c.json.count;
  }
  const adv = L.advancedQueryCapabilities ?? {};
  return {
    ...base,
    url: layerUrl,
    schema: (L.fields ?? []).map((f: any) => ({ name: f.name, type: String(f.type ?? "").replace(/^esriFieldType/, "").toLowerCase(), ...(f.alias && f.alias !== f.name ? { alias: f.alias } : {}) })),
    row_count: count,
    sample,
    data_modified: typeof L.editingInfo?.lastEditDate === "number" ? new Date(L.editingInfo.lastEditDate).toISOString() : null,
    query_caps: {
      layer: L.id ?? null, layer_name: L.name ?? null, layers, geometry_type: L.geometryType ?? null,
      max_record_count: L.maxRecordCount ?? null, pagination: adv.supportsPagination ?? null, statistics: adv.supportsStatistics ?? L.supportsStatistics ?? null,
      formats: L.supportedQueryFormats ?? null, capabilities: L.capabilities ?? null, extent: L.extent ?? null,
    },
    error: canQuery ? qerr : "query not supported",
  };
}
