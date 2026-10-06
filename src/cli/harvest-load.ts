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
console.table(await all(conn, "select source_id, count(*)::int as datasets, count(duplicate_of)::int as mirrored from datasets group by 1 order by 2 desc"));
await closeDb(conn);
