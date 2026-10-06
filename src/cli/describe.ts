/**
 * Describe live-queryable resources: columns, row count, sample rows, query limits (see src/connectors/describe.ts).
 * Fetches into data/describe/results.jsonl without holding the DB (resumable: described keys are skipped),
 * then `--load` writes resource_describe. One request at a time per host, 500 ms apart; hosts run in parallel.
 *
 *   pnpm describe [--only source_id,...] [--kind ckan_datastore|esri] [--per-source N] [--parallel 8] [--refresh]
 *   pnpm describe --load
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { ROOT, all, closeDb, db, loadJsonl } from "../db.js";
import { describeDatastore, describeEsri, type Described } from "../connectors/describe.js";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const DIR = join(ROOT, "data/describe");
const OUT = join(DIR, "results.jsonl");
mkdirSync(DIR, { recursive: true });

if (process.argv.includes("--load")) {
  // Last result per key wins (a refresh appends).
  const conn = await db();
  await all(conn, `create or replace temp table d_in as select * from read_json('${OUT}', format='newline_delimited',
    columns={key:'VARCHAR', kind:'VARCHAR', url:'VARCHAR', schema:'JSON', row_count:'BIGINT', sample:'JSON', data_modified:'TIMESTAMP', query_caps:'JSON', error:'VARCHAR', described_at:'TIMESTAMP'})`);
  await all(conn, `insert or replace into resource_describe select * exclude (rn) from (select *, row_number() over (partition by key order by described_at desc) as rn from d_in) where rn = 1`);
  console.table(await all(conn, `select kind, count(*)::int as described, count(*) filter (where error is null)::int as ok, count(row_count)::int as with_count, count(data_modified)::int as with_edit_date from resource_describe group by 1`));
  await closeDb(conn);
  process.exit(0);
}

const ONLY = arg("--only")?.split(",");
const KIND = arg("--kind");
const PER_SOURCE = arg("--per-source") ? Number(arg("--per-source")) : null;
const conn = await db();
// Unique things to describe among unique data records' live resources.
let targets = await all<{ key: string; kind: string; host: string; url: string; base: string | null; rid: string | null; source_id: string }>(conn, `
  with t as (
    select case when r.datastore then 'datastore:' || r.source_id || '|' || regexp_extract(r.id, '[^|]+$') else lower(regexp_replace(r.url, '/+$', '')) end as key,
      case when r.datastore then 'ckan_datastore' else 'esri' end as kind,
      r.url, s.base_url as base, regexp_extract(r.id, '[^|]+$') as rid, r.source_id
    from resources r join datasets d on d.id = r.dataset_id join sources s on s.id = r.source_id
    where d.duplicate_of is null and d.record_kind = 'data' and r.tier = 'live_query'
      and (r.datastore or regexp_matches(r.url, '/(FeatureServer|MapServer)(/\\d+)?/?$', 'i')))
  select key, any_value(kind) as kind, any_value(url) as url, any_value(base) as base, any_value(rid) as rid, any_value(source_id) as source_id,
    regexp_extract(case when any_value(kind) = 'ckan_datastore' then any_value(base) else any_value(url) end, '^https?://([^/]+)', 1) as host
  from t group by key`);
await closeDb(conn);

if (ONLY) targets = targets.filter((t) => ONLY.includes(t.source_id));
if (KIND) targets = targets.filter((t) => t.kind === KIND);
if (PER_SOURCE) {
  const n = new Map<string, number>();
  targets = targets.filter((t) => (n.set(t.source_id, (n.get(t.source_id) ?? 0) + 1).get(t.source_id)! <= PER_SOURCE));
}
const done = new Set<string>();
if (!process.argv.includes("--refresh") && existsSync(OUT))
  for (const line of readFileSync(OUT, "utf8").split("\n")) if (line) done.add(JSON.parse(line).key);
targets = targets.filter((t) => !done.has(t.key));

const byHost = new Map<string, typeof targets>();
for (const t of targets) byHost.set(t.host, [...(byHost.get(t.host) ?? []), t]);
console.log(`${targets.length} to describe on ${byHost.size} hosts (${done.size} already done)`);

const t0 = Date.now();
let n = 0, errors = 0;
const gap = () => new Promise<void>((r) => setTimeout(r, 500));
const limit = pLimit(Number(arg("--parallel") ?? 8));
await Promise.all([...byHost.entries()].map(([host, list]) => limit(async () => {
  for (const t of list) {
    const d: Described = t.kind === "ckan_datastore" ? await describeDatastore(t.key, t.base!, t.rid!, gap) : await describeEsri(t.key, t.url, gap);
    appendFileSync(OUT, JSON.stringify(d) + "\n");
    n++;
    if (d.error) errors++;
    if (n % 500 === 0) console.log(`${n}/${targets.length} (${errors} with errors, ${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  console.log(`host done: ${host} (${list.length})`);
})));
console.log(`described ${n} in ${Math.round((Date.now() - t0) / 1000)}s, ${errors} with errors. Load with: pnpm describe --load`);
