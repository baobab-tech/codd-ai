/**
 * Pull the Canadian Open Data Directory org list into the `orgs` table and data/directory/.
 *
 * The site (SvelteKit) has no API. The org list is a CSV string embedded as a template literal
 * in one of its JS chunks. We walk the bundle's import graph until we find it.
 */
import Papa from "papaparse";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, all, db, upsert } from "../db.js";
import { fetchText } from "../http.js";

const BASE = "https://directory.opendatasociety.ca";
const HEADER_MARK = "Name of Organization (EN)";

// Directory "Portal Software" label -> platform key.
const PLATFORMS: Record<string, string> = {
  ckan: "ckan",
  dkan: "dkan",
  "arcgis hub": "arcgis_hub",
  "tyler technologies": "socrata",
  dataverse: "dataverse",
  "open data soft": "opendatasoft",
  opendatasoft: "opendatasoft",
  "api access only": "api_only",
};

// Directory column prefix -> field.
const COLUMNS: [string, string][] = [
  ["Name of Organization (EN)", "name_en"],
  ["Name of Organization (FR)", "name_fr"],
  ["Website (EN)", "url_en"],
  ["Website (FR)", "url_fr"],
  ["HQ Location (EN)", "location"],
  ["latitude", "lat"],
  ["longitude", "lon"],
  ["HQ Geographic Region (EN)", "region"],
  ["Alpha Code", "province"],
  ["Organization Type (EN)", "org_type"],
  ["Portal Software (EN)", "portal_software"],
  ["Primary Language (EN)", "language"],
  ["Is Website Data Catalogue?", "is_catalogue"],
  ["Total Assets", "total_assets"],
  ["Number of Datasets", "dataset_count"],
  ["Entity Type (EN)", "entity_type"],
  ["Relationship (EN)", "relationship"],
  ["Notes (EN)", "notes"],
  ["Last Updated", "directory_updated"],
];

async function findCsv(): Promise<{ chunk: string; csv: string }> {
  const page = await fetchText(`${BASE}/directory`);
  const queue = [...page.body.matchAll(/["'](\.?\/?_app\/immutable\/[^"']+\.js)["']/g)].map((m) => new URL(m[1], `${BASE}/directory`).href);
  const seen = new Set<string>();
  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const js = (await fetchText(url)).body;
    const i = js.indexOf("`" + HEADER_MARK);
    if (i !== -1) return { chunk: url, csv: js.slice(i + 1, js.indexOf("`", i + 1)) };
    for (const m of js.matchAll(/["'](\.{1,2}\/[^"']+\.js)["']/g)) queue.push(new URL(m[1], url).href);
  }
  throw new Error(`CSV not found after scanning ${seen.size} JS files; the site build changed.`);
}

const unescapeTemplate = (s: string) => s.replace(/\\`/g, "`").replace(/\\\$\{/g, "${").replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");

export const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const num = (v?: string) => (v && /^\d+$/.test(v.replace(/,/g, "").trim()) ? Number(v.replace(/,/g, "")) : null);

async function main() {
  const { chunk, csv: raw } = await findCsv();
  const csv = unescapeTemplate(raw);
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

  mkdirSync(join(ROOT, "data/directory"), { recursive: true });
  writeFileSync(join(ROOT, "data/directory/directory.csv"), csv);

  const now = new Date().toISOString();
  const ids = new Set<string>();
  const rows = parsed.data.map((row) => {
    const r: Record<string, string> = {};
    for (const [col, val] of Object.entries(row)) {
      const hit = COLUMNS.find(([prefix]) => col.startsWith(prefix));
      if (hit) r[hit[1]] = (val ?? "").trim();
    }
    // Quebec orgs often list only a French URL.
    const url = r.url_en || r.url_fr || null;
    let id = slugify(r.name_en);
    for (let n = 2; ids.has(id); n++) id = `${slugify(r.name_en)}-${n}`;
    ids.add(id);
    return {
      id,
      name_en: r.name_en,
      name_fr: r.name_fr || null,
      url,
      url_fr: r.url_fr || null,
      host: url ? new URL(url).host.toLowerCase() : null,
      platform_label: PLATFORMS[(r.portal_software ?? "").toLowerCase()] ?? "unknown",
      portal_software: r.portal_software || null,
      org_type: r.org_type || null,
      region: r.region || null,
      province: r.province || null,
      location: r.location || null,
      lat: r.lat ? Number(r.lat) : null,
      lon: r.lon ? Number(r.lon) : null,
      language: r.language || null,
      is_catalogue: r.is_catalogue === "1",
      entity_type: r.entity_type || null,
      relationship: r.relationship || null,
      dataset_count: num(r.dataset_count),
      total_assets: num(r.total_assets),
      notes: r.notes || null,
      directory_updated: r.directory_updated || null,
      synced_at: now,
    };
  });

  const conn = await db();
  const before = new Set((await all<{ id: string }>(conn, "select id from orgs")).map((r) => r.id));
  await upsert(conn, "orgs", rows);
  const removed = [...before].filter((id) => !ids.has(id));
  if (removed.length) await conn.run(`delete from orgs where id in (${removed.map((id) => `'${id}'`).join(",")})`);
  const added = [...ids].filter((id) => !before.has(id));

  const total = rows.reduce((s, r) => s + (r.dataset_count ?? 0), 0);
  writeFileSync(
    join(ROOT, "data/directory/snapshot.json"),
    JSON.stringify({ source: `${BASE}/directory`, chunk, fetched_at: now, organizations: rows.length, dataset_count_sum: total }, null, 2) + "\n",
  );
  console.log(`${rows.length} orgs (${total} datasets reported) from ${chunk}`);
  if (before.size) console.log(`added: ${added.join(", ") || "-"}\nremoved: ${removed.join(", ") || "-"}`);
}

await main();
