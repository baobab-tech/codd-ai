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
    select o.id, max(case when s.status in ('identified','harvestable','harvested') then 3 when s.status in ('proposed','needs_human') then 2 when s.id is not null then 1 else 0 end) as r
    from orgs o left join org_sources os on os.org_id = o.id left join sources s on s.id = os.source_id group by 1)
  select case r when 3 then 'source identified (API or confirmed recipe)' when 2 then 'in review queue' when 1 then 'other' else 'no source (dead link or no URL)' end as readiness,
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
table(await q(`select key, count(*)::int as orgs from observations where key in ('html_blocked_api_ok', 'rate_challenge') group by 1`));
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
