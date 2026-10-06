/**
 * Load completed harvest shards (data/harvest/<source>/) into the datasets and resources tables.
 * Replaces each source's previous rows and updates sources.harvested_at / harvested_count / status.
 *
 *   pnpm harvest:load [--only source_id,...]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, all, closeDb, db, loadJsonl } from "../db.js";

const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const base = join(ROOT, "data/harvest");
const conn = await db();

for (const d of existsSync(base) ? readdirSync(base) : []) {
  const dir = join(base, d);
  const mf = join(dir, "manifest.json");
  if (!existsSync(mf)) continue; // incomplete harvest
  const m = JSON.parse(readFileSync(mf, "utf8")) as { source_id: string; finished: string; datasets: number; resources: number };
  if (ONLY && !ONLY.includes(m.source_id)) continue;
  await all(conn, "delete from resources where source_id = $s", { s: m.source_id });
  await all(conn, "delete from datasets where source_id = $s", { s: m.source_id });
  await loadJsonl(conn, "datasets", join(dir, "datasets.jsonl.gz"));
  await loadJsonl(conn, "resources", join(dir, "resources.jsonl.gz"));
  await all(conn, "update sources set harvested_at = $t::timestamp, harvested_count = $n, status = 'harvested' where id = $s", { t: m.finished, n: m.datasets, s: m.source_id });
  console.log(`loaded ${m.source_id}: ${m.datasets} datasets, ${m.resources} resources`);
}
// Mirrors: a source whose recipe says {"mirrors": "<source_id>"} republishes that portal's records.
// Point its copies at the original so counts and readiness use each dataset once.
await all(conn, `update datasets d set duplicate_of = m.id
  from sources s, datasets m
  where d.source_id = s.id and (s.recipe->>'mirrors') is not null
    and m.source_id = (s.recipe->>'mirrors') and m.native_id = d.native_id`);
// Classify every record, all platforms (cheap; no refetch needed when the rules change).
await all(conn, `update datasets set licence_class = case
    when l similar to '.*(non.?commercial|by-nc|by nc|cc-nc|\\bnc\\b).*' then 'non_commercial'
    when l similar to '.*(no.?deriv|by-nd|\\bnd\\b).*' then 'no_derivatives'
    when l similar to '.*unrestricted use.*' then 'open'
    when l similar to '.*(not open|closed|other-closed|all rights reserved|restricted|access only|king.?s printer|queen.?s printer|crown copyright|^copyright|copyright [0-9]).*' then 'restricted'
    when l similar to '.*(licen[cs]e not specified|not specified|not applicable).*' then 'none'
    when coalesce(is_open, false)
      or l similar to '.*(open[ -]?(government|data|gov\\.?)[ -]?licen|open licen|openmb|licence du gouvernement ouvert|licence ouverte|cc[ -]?by|cc[ -]?0|creative commons attribution|public domain|pddl|odc-?by|odbl|open database licen|royalty-free, perpetual).*' then 'open'
    when trim(l) in ('', 'none', 'license not specified', 'notspecified', 'not specified', 'other') then 'none'
    else 'unclear' end
  from (select id as did, lower(coalesce(licence, '') || ' ' || coalesce(licence_url, '')) as l from datasets) x
  where datasets.id = x.did`);
await all(conn, `update datasets set record_kind = case
    when lower(coalesce(type, '')) in ('info', 'publication', 'publications', 'documentation', 'pdf', 'document link', 'microsoft word', 'microsoft powerpoint') then 'document'
    when type in ('Web Map', 'Web Experience', 'Dashboard', 'Hub Page', 'Hub Site Application', 'Site Application', 'Web Mapping Application', 'StoryMap', 'Story Map', 'Application', 'Form', 'Insights Page', 'Web Scene', 'Mobile Application', 'Notebook', 'project', 'campaign', 'platform', 'instrument_details', 'deployment_details') then 'app'
    else 'data' end`);

// ArcGIS item ids are global: the same item shown on several Hub sites is one dataset.
// Canonical copy: the site whose directory org name matches the item's ArcGIS org name; else the site whose
// home org (most common publisher) owns it; else the first source id.
await all(conn, `update datasets set duplicate_of = null where source_id in (select id from sources where platform = 'arcgis_hub')`);
await all(conn, `with hub as (select d.id, d.source_id, d.native_id, d.publisher, d.publisher_title from datasets d join sources s on s.id = d.source_id where s.platform = 'arcgis_hub'),
  home as (select source_id, mode(publisher) as org from hub group by 1),
  site_org as (select os.source_id, string_agg(lower(o.name_en), ' | ') as names from org_sources os join orgs o on o.id = os.org_id group by 1),
  ranked as (select h.id, first_value(h.id) over (
      partition by h.native_id
      order by (h.publisher_title is not null and contains(coalesce(so.names, ''), lower(h.publisher_title))) desc,  -- the directory org that owns the item
               (h.publisher = m.org) desc,                                                                              -- else the site whose home org owns it
               h.source_id) as canon
    from hub h join home m using (source_id) left join site_org so using (source_id))
  update datasets set duplicate_of = r.canon from ranked r where datasets.id = r.id and r.canon <> r.id`);
console.table(await all(conn, "select source_id, count(*)::int as datasets, count(duplicate_of)::int as duplicates from datasets group by 1 order by 2 desc"));
await closeDb(conn);
