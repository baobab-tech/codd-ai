/**
 * Collect everything a landscape report needs (aggregates, observations, open items, findings) into one markdown digest.
 * A session turns this into the narrative report; see CLAUDE.md.
 *
 *   pnpm digest [--out reports/digest.md]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { all, db } from "../db.js";

const conn = await db();
const out: string[] = [];
const h = (t: string) => out.push(`\n## ${t}\n`);

function table(rows: Record<string, unknown>[]) {
  if (!rows.length) return out.push("_none_\n");
  const cols = Object.keys(rows[0]);
  out.push(`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of rows) out.push(`| ${cols.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
  out.push("");
}
const q = (sql: string) => all(conn, sql);

// Org → its effective platform (top-level source or "none").
const ORG_PLATFORM = `
  select o.*, coalesce(min(s.platform), 'none') as platform, max(s.archetype) as archetype,
    max(case when s.status in ('identified', 'harvestable', 'harvested') then 1 else 0 end) as ready
  from orgs o left join org_sources os on os.org_id = o.id left join sources s on s.id = os.source_id
  group by all`;

out.push(`# Discovery digest\n\nGenerated ${new Date().toISOString().slice(0, 16)}Z from the working DB. Input for the landscape report, not the report itself.`);

h("Scope");
table(await q(`select count(*)::int as orgs, sum(dataset_count)::int as datasets_reported_by_directory,
  (select max(synced_at)::date::varchar from orgs) as directory_synced,
  (select max(fetched_at)::date::varchar from probes) as last_probe,
  (select count(*)::int from probes) as probe_requests from orgs`));

h("Platforms (detected by API)");
table(await q(`select platform, count(*)::int as orgs, round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_orgs
  from (${ORG_PLATFORM}) group by 1 order by orgs desc`));

h("Org readiness (best source status per org)");
table(await q(`with best as (
    select o.id, max(case when s.status in ('identified','harvestable','harvested') then 3 when s.status in ('proposed','needs_human','blocked') then 2 when s.status = 'not_data' then 1 when s.id is not null then 1 else 0 end) as r
    from orgs o left join org_sources os on os.org_id = o.id left join sources s on s.id = os.source_id group by 1)
  select case r when 3 then 'source identified (API or confirmed recipe)' when 2 then 'blocked or in review' when 1 then 'checked: not a data source' else 'no source (dead link or no URL)' end as readiness,
    count(*)::int as orgs, round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
  from best group by r order by r desc`));

h("Live dataset counts (top-level sources)");
table(await q(`select platform, count(*)::int as sources, sum(dataset_count)::int as live_datasets
  from sources where parent_id is null and platform <> 'unknown' group by 1 order by live_datasets desc nulls last`));

h("Largest gaps between directory and live counts");
table(await q(`select o.name_en as org, s.platform, s.dataset_count as live, o.dataset_count as directory
  from sources s join org_sources os on os.source_id = s.id join orgs o on o.id = os.org_id
  where s.dataset_count is not null order by abs(s.dataset_count - coalesce(o.dataset_count, 0)) desc limit 10`));

h("API coverage by org type");
table(await q(`select org_type, count(*)::int as orgs, sum(ready)::int as source_identified
  from (${ORG_PLATFORM}) group by 1 order by orgs desc`));

h("API coverage by province");
table(await q(`select coalesce(province, '?') as province, count(*)::int as orgs, sum(ready)::int as source_identified
  from (${ORG_PLATFORM}) group by 1 order by orgs desc`));

h("Harvest coverage");
table(await q(`select s.platform, count(*)::int as sources_harvested, sum(s.harvested_count)::int as records,
  (select count(*)::int from datasets d join sources x on x.id = d.source_id where x.platform = s.platform and d.duplicate_of is null) as unique_records
  from sources s where s.harvested_at is not null group by 1 order by records desc`));

h("Unique harvested records by kind");
table(await q(`select record_kind, count(*)::int as records, round(count(*) * 100.0 / sum(count(*)) over (), 1) as pct from v_dataset_readiness group by 1 order by 2 desc`));

h("Dataset readiness (unique data records, %)");
table(await q(`select count(*)::int as data_records, round(avg(machine_readable)*100,1) as machine_readable, round(avg(live_query)*100,1) as live_query,
  round(avg(open_licence)*100,1) as open_licence, round(avg(described)*100,1) as described, round(avg(discoverable)*100,1) as discoverable,
  round(avg(fresh)*100,1) as metadata_fresh_12mo, round(avg(themed)*100,1) as themed, round(avg(spatial)*100,1) as spatial,
  round(avg(contact)*100,1) as contact, round(avg(bilingual)*100,1) as bilingual from v_dataset_readiness where record_kind = 'data'`));

h("Readiness by platform and record kind (unique records, %)");
table(await q(`select s.platform, r.record_kind, count(*)::int as records, round(avg(r.machine_readable)*100,1) as machine_readable,
  round(avg(r.live_query)*100,1) as live_query, round(avg(r.open_licence)*100,1) as open_licence, round(avg(r.described)*100,1) as described,
  round(avg(r.discoverable)*100,1) as discoverable, round(avg(r.themed)*100,1) as themed
  from v_dataset_readiness r join sources s on s.id = r.source_id group by all order by s.platform, records desc`));

h("CKAN DataStore coverage by portal (data records)");
table(await q(`select d.source_id, count(distinct d.id)::int as data_records,
  count(distinct d.id) filter (where r.datastore)::int as with_datastore,
  round(100.0 * count(distinct d.id) filter (where r.datastore) / count(distinct d.id), 1) as pct_datastore,
  count(distinct d.id) filter (where r.tier = 'live_query' and not r.datastore)::int as other_live_api
  from datasets d join resources r on r.dataset_id = d.id join sources s on s.id = d.source_id
  where s.platform = 'ckan' and d.duplicate_of is null and d.record_kind = 'data' group by 1 order by data_records desc`));

h("Licence classes of data records, by platform");
table(await q(`with x as (select s.platform, d.licence_class, count(*) as n from datasets d join sources s on s.id = d.source_id
    where d.duplicate_of is null and d.record_kind = 'data' group by 1, 2)
  select platform, licence_class, n::int as records, round(100.0 * n / sum(n) over (partition by platform), 1) as pct from x order by platform, records desc`));

h("Most common unclassified or missing licence labels (data records)");
table(await q(`select left(coalesce(licence, '(empty)'), 70) as licence, licence_class, count(*)::int as records from datasets
  where duplicate_of is null and record_kind = 'data' and licence_class in ('unclear', 'none') group by all order by records desc limit 10`));

h("Best resource tier per data record");
table(await q(`select coalesce(best_tier, '(no resources)') as best_tier, count(*)::int as data_records, round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
  from datasets where duplicate_of is null and record_kind = 'data' group by 1 order by 2 desc`));

h("Top resource formats (resources of data records)");
table(await q(`select r.format, r.tier, count(*)::int as resources from resources r join datasets d on d.id = r.dataset_id
  where d.duplicate_of is null and d.record_kind = 'data' group by all order by resources desc limit 15`));

h("Readiness by harvested source (unique records by kind; % of its data records)");
table(await q(`select id as source, unique_records, data_records, document_records as documents, app_records as apps, image_records as images, inventory_records as inventory,
  round(share_machine_readable*100) as machine_readable, round(share_live_query*100) as live_query,
  round(share_open_licence*100) as open_licence, round(share_described*100) as described, round(share_fresh*100) as metadata_fresh
  from v_source_readiness where harvested_count is not null order by data_records desc, unique_records desc`));

h("Describe pass (live-queryable resources: schema, row count, sample, edit date)");
table(await q(`select kind, count(*)::int as described, count(*) filter (where error is null)::int as ok,
    round(100.0 * count(*) filter (where error is null) / count(*), 1) as pct_ok,
    round(median(json_array_length(schema)) filter (where error is null), 0) as median_columns,
    sum(row_count) filter (where error is null)::bigint as total_rows,
    count(data_modified)::int as with_edit_date,
    count(*) filter (where data_modified >= now() - interval 1 year)::int as edited_last_12mo
  from resource_describe group by 1 order by 2 desc`));
table(await q(`select kind, regexp_replace(left(error, 40), '[0-9a-f-]{20,}', '…') as error, count(*)::int as n from resource_describe where error is not null group by all order by n desc limit 8`));
table(await q(`select coalesce(query_caps->>'max_record_count', '?') as max_record_count, count(*)::int as layers from resource_describe where kind = 'esri' and error is null group by 1 order by 2 desc limit 6`));

h("Record types by source (platform's own type field)");
table(await q(`select source_id, type, count(*)::int as records from datasets where duplicate_of is null group by all having count(*) >= 50 order by source_id, records desc`));

h("Duplicates (mirrors and items shown on several Hub sites)");
table(await q(`select s.platform, count(*)::int as duplicate_records, count(distinct d.source_id)::int as sources from datasets d join sources s on s.id = d.source_id where d.duplicate_of is not null group by 1`));

h("Source archetypes and status");
table(await q(`select coalesce(archetype, '(unprofiled)') as archetype, status, count(*)::int as sources from sources group by all order by sources desc`));

h("Reachability");
table(await q(`select count(*)::int as orgs_probed,
  sum(case when (value->>'status')::int = 200 then 1 else 0 end)::int as http_200,
  sum(case when (value->>'status')::int between 400 and 599 then 1 else 0 end)::int as http_4xx_5xx,
  sum(case when (value->>'status')::int = 0 then 1 else 0 end)::int as unreachable,
  sum(case when (value->>'https')::bool then 1 else 0 end)::int as https,
  median((value->>'ms')::int)::int as median_ms
  from observations where key = 'access'`));
table(await q(`select key, count(*)::int as orgs from observations where key in ('html_blocked_api_ok', 'rate_challenge', 'api_blocked') group by 1`));
table(await q(`select value->>'blocked' as block_signature, count(*)::int as orgs from observations where key = 'access' and (value->>'blocked') is not null group by 1`));

h("robots.txt");
table(await q(`select
  sum(case when (value->>'present')::bool then 0 else 1 end)::int as no_robots,
  sum(case when (value->>'star_disallow_all')::bool then 1 else 0 end)::int as disallow_all,
  sum(case when json_array_length(value->'ai_agents_named') > 0 then 1 else 0 end)::int as names_ai_agents,
  sum(case when json_array_length(value->'ai_agents_blocked') > 0 then 1 else 0 end)::int as blocks_ai_agents,
  sum(case when json_array_length(value->'content_signal') > 0 then 1 else 0 end)::int as content_signal
  from observations where key = 'robots'`));
table(await q(`select subject_id as org, value->>'ai_agents_blocked' as ai_agents_blocked, (value->>'star_disallow_all')::bool as disallow_all
  from observations where key = 'robots' and (json_array_length(value->'ai_agents_blocked') > 0 or (value->>'star_disallow_all')::bool) order by 1`));

h("Our corrections to the directory");
table(await q(`select org_id, field, value, note from org_overrides order by 1`));

h("Open items");
table(await q(`select kind, status, count(*)::int as n from open_items group by all order by status, n desc`));
table(await q(`select kind, title, coalesce(resolution, '') as resolution from open_items where kind <> 'needs_profiling' order by status, kind, title`));

h("Findings (session discoveries)");
const findings = await q(`select topic, subject_type || ':' || subject_id as subject, finding, evidence, author, created_at::date::varchar as date from findings order by topic, id`);
if (!findings.length) out.push("_none recorded yet_\n");
let topic = "";
for (const f of findings as Record<string, string>[]) {
  if (f.topic !== topic) out.push(`\n### ${(topic = f.topic)}\n`);
  out.push(`- ${f.finding} _(${f.subject}; ${f.author} ${f.date}${f.evidence ? `; ${f.evidence}` : ""})_`);
}

const md = out.join("\n") + "\n";
const file = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
if (file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, md);
  console.log(`wrote ${file}`);
} else process.stdout.write(md);
