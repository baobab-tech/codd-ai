import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pLimit from "p-limit";

// One connection is shared by concurrent tasks; DuckDB statements on it must not overlap.
const serial = pLimit(1);

export const ROOT = new URL("..", import.meta.url).pathname;
export const DB_PATH = process.env.CODD_DB ?? join(ROOT, "db/codd.duckdb");

// Working state lives in DuckDB; `pnpm export` writes each table to registry/<table>.jsonl for git.
// Tables listed here are exported/imported in this order.
export const TABLES = ["orgs", "org_overrides", "sources", "org_sources", "connectors", "open_items", "observations", "findings", "datasets", "resources", "probes"] as const;

const SCHEMA = `
-- One row per organization in the Canadian Open Data Directory. Overwritten by sync.
create table if not exists orgs (
  id varchar primary key,
  name_en varchar not null,
  name_fr varchar,
  url varchar,
  url_fr varchar,
  host varchar,
  platform_label varchar,          -- directory's "Portal Software", normalized
  portal_software varchar,         -- directory's raw label
  org_type varchar,
  region varchar,
  province varchar,
  location varchar,
  lat double,
  lon double,
  language varchar,
  is_catalogue boolean,
  entity_type varchar,
  relationship varchar,
  dataset_count integer,           -- self-reported in the directory
  total_assets integer,
  notes varchar,
  directory_updated varchar,
  synced_at timestamp
);

-- Our corrections to directory fields. The orgs row keeps the directory value; probe and connectors read the override.
create table if not exists org_overrides (
  org_id varchar,
  field varchar,                   -- url (more fields as needed)
  value varchar,
  note varchar,                    -- why, and who/what found it
  created_at timestamp,
  primary key (org_id, field)
);

-- A thing we can point a connector at: a portal, a scoped slice of a portal, a document library, an API.
create table if not exists sources (
  id varchar primary key,
  kind varchar not null,           -- portal | portal_scope | api | website | document_library
  platform varchar,                -- ckan | arcgis_hub | arcgis_server | socrata | opendatasoft | dataverse | geonetwork | dcat | figshare | statcan_wds | custom | unknown
  base_url varchar not null,       -- API base or landing URL
  scope json,                      -- e.g. {"ckan_fq": "organization:ville-de-laval"}
  connector_id varchar,
  status varchar not null,         -- needs_profiling | proposed | needs_human | identified | harvestable | harvested | not_data (see docs/PLAN.md)
  dataset_count integer,           -- live count from the platform API
  first_seen timestamp,
  last_probed timestamp,
  notes varchar
);

alter table sources add column if not exists parent_id varchar;  -- portal_scope -> its portal
-- How to connect when platform + base_url + scope isn't enough: connector config written during profiling
-- (start URLs, link patterns, service roots, discovered backend endpoints, auth notes...).
alter table sources add column if not exists recipe json;
alter table sources add column if not exists curated boolean default false;  -- set by profiling; probe never deletes or relinks curated sources
alter table sources add column if not exists harvested_at timestamp;
alter table sources add column if not exists harvested_count integer;
alter table sources add column if not exists archetype varchar;  -- platform_api | known_api | esri_rest | web_listing | js_app | document_library | not_data

create table if not exists org_sources (
  org_id varchar,
  source_id varchar,
  role varchar,                    -- primary | published_under | listed
  primary key (org_id, source_id)
);

-- One connector serves many sources of the same platform.
create table if not exists connectors (
  id varchar primary key,
  platform varchar,
  status varchar not null,         -- planned | building | ready
  description varchar,
  notes varchar
);

-- What we still need to figure out, fix, or decide.
create table if not exists open_items (
  id varchar primary key,          -- deterministic: <kind>:<subject_id>[:<detail>]
  kind varchar not null,           -- needs_review (agent) | needs_human (person) | decision (person) | blocker | dead_link | platform_mismatch | data_error | needs_profiling
  subject_type varchar not null,   -- org | source | connector | project
  subject_id varchar,
  status varchar not null,         -- open | stale (auto-cleared, not seen on last probe) | resolved | wontfix
  title varchar not null,
  detail varchar,
  resolution varchar,
  created_at timestamp,
  updated_at timestamp
);

-- Landscape facts about a subject (agent-friendliness, licence, bot rules, formats...). Latest value per key wins.
create table if not exists observations (
  subject_type varchar,
  subject_id varchar,
  key varchar,
  value json,
  evidence varchar,                -- URL or probe id
  observed_at timestamp,
  primary key (subject_type, subject_id, key)
);

-- Harvested catalog records (Part 1: registry). One row per dataset in a source's catalog.
-- Datasets belong to the top-level source they were listed from; publisher identifies the org inside a shared portal.
create table if not exists datasets (
  id varchar primary key,          -- <source_id>|<native_id>
  source_id varchar not null,
  native_id varchar not null,      -- platform id (CKAN package id, Hub item id, ...)
  name varchar,                    -- slug, where the platform has one
  title varchar,
  description varchar,
  publisher varchar,               -- org slug inside the portal (CKAN organization.name)
  publisher_title varchar,
  type varchar,                    -- platform's record type (CKAN: dataset, info, publication, ...)
  tags json,
  licence varchar,
  landing_url varchar,
  created varchar,
  modified varchar,
  harvested_at timestamp
);
-- AI-readiness fields, normalized across platforms (see docs/AI-READINESS.md).
alter table datasets add column if not exists themes json;          -- portal groups / subjects / topic categories / Hub categories
alter table datasets add column if not exists keywords json;        -- free keywords beyond tags (CKAN fluent keywords)
alter table datasets add column if not exists frequency varchar;    -- declared update frequency
alter table datasets add column if not exists has_spatial boolean;  -- spatial extent or geographic coverage declared
alter table datasets add column if not exists bilingual boolean;    -- title present in both en and fr
alter table datasets add column if not exists is_open boolean;      -- platform says the licence is open (CKAN isopen)
alter table datasets add column if not exists licence_url varchar;
alter table datasets add column if not exists has_contact boolean;  -- maintainer or author contact present
alter table datasets add column if not exists resource_count integer;
alter table datasets add column if not exists formats json;         -- distinct normalized resource formats
alter table datasets add column if not exists best_tier varchar;    -- most capable resource tier
alter table datasets add column if not exists access_level varchar;
alter table datasets add column if not exists duplicate_of varchar;
alter table datasets add column if not exists extras json;
alter table datasets add column if not exists licence_class varchar;  -- open | non_commercial | no_derivatives | restricted | unclear | none (classify step in harvest:load)
alter table datasets add column if not exists record_kind varchar;    -- data | document | app | image | inventory (classify step in harvest:load)           -- platform-specific signals (ArcGIS: orgId, owner, numViews, scoreCompleteness)  -- set when the source mirrors another portal (sources.recipe.mirrors) and the record exists there -- open / restricted / under review, where declared

-- Downloadable or queryable things inside a dataset.
create table if not exists resources (
  id varchar primary key,          -- <dataset_id>|<native_id or index>
  dataset_id varchar not null,
  source_id varchar not null,
  name varchar,
  url varchar,
  format varchar,                  -- normalized upper-case (CSV, XLSX, SHP, PDF, ...)
  mimetype varchar,
  size bigint,
  datastore boolean,               -- CKAN DataStore: queryable via datastore_search
  tier varchar,                    -- live_query | tabular_file | geo_file | document | link_only
  modified varchar
);

-- Narrative discoveries: anything learned in a session that a report should mention. Append-only.
-- Structured, machine-refreshed facts go in observations; human/agent insight goes here.
create sequence if not exists findings_seq;
create table if not exists findings (
  id integer primary key default nextval('findings_seq'),
  topic varchar not null,          -- platforms | counts | reachability | bot_blocking | robots | data_quality | access_patterns | formats | licensing | connectors | other
  subject_type varchar,            -- org | source | connector | platform | project
  subject_id varchar,
  finding varchar not null,        -- one fact, written to be quoted in a report
  evidence varchar,                -- URL, SQL query, or probe reference
  author varchar,                  -- probe | claude | maintainer handle
  created_at timestamp default now()
);

-- AI-readiness views (docs/AI-READINESS.md). Recomputed on every query; the report reads these.
create or replace view v_dataset_readiness as
select d.id, d.source_id, d.publisher, d.title, d.best_tier, d.record_kind, d.licence_class,
  (d.best_tier in ('live_query', 'tabular_file', 'geo_file'))::int as machine_readable,
  (d.best_tier = 'live_query')::int as live_query,
  (d.licence_class = 'open')::int as open_licence,
  (length(coalesce(d.description, '')) >= 100)::int as described,
  (coalesce(json_array_length(d.tags), 0) + coalesce(json_array_length(d.keywords), 0) >= 3)::int as discoverable,
  (try_cast(d.modified as timestamp) >= now() - interval 1 year)::int as fresh,
  (coalesce(json_array_length(d.themes), 0) > 0)::int as themed,
  -- null when the platform doesn't expose the field; avg() then ignores it instead of counting it as a no
  d.has_spatial::int as spatial,
  d.has_contact::int as contact,
  d.bilingual::int as bilingual
from datasets d
where d.duplicate_of is null;

create or replace view v_source_readiness as
select s.id, s.platform, s.archetype, s.status,
  (s.archetype in ('platform_api', 'known_api', 'esri_rest') and s.status in ('identified', 'harvestable', 'harvested'))::int as catalog_api,
  s.dataset_count, s.harvested_count,
  -- unique records by kind; the shares below are over data records only, so documents and apps don't dilute them
  count(r.id) as unique_records,
  count(r.id) filter (where r.record_kind = 'data') as data_records,
  count(r.id) filter (where r.record_kind = 'document') as document_records,
  count(r.id) filter (where r.record_kind = 'app') as app_records,
  count(r.id) filter (where r.record_kind = 'image') as image_records,
  count(r.id) filter (where r.record_kind = 'inventory') as inventory_records,
  avg(r.machine_readable) filter (where r.record_kind = 'data') as share_machine_readable,
  avg(r.live_query) filter (where r.record_kind = 'data') as share_live_query,
  avg(r.open_licence) filter (where r.record_kind = 'data') as share_open_licence,
  avg(r.described) filter (where r.record_kind = 'data') as share_described,
  avg(r.fresh) filter (where r.record_kind = 'data') as share_fresh
from sources s left join v_dataset_readiness r on r.source_id = s.id
where s.parent_id is null
group by all;

-- Describe pass (pnpm describe): schema, row count, sample rows and query limits for live-queryable resources.
-- Keyed by the thing described, not the resource row, so it survives re-harvests and shared services are described once.
create table if not exists resource_describe (
  key varchar primary key,         -- datastore:<source_id>|<resource_id>, or the lowercased Esri service/layer URL
  kind varchar,                    -- ckan_datastore | esri
  url varchar,                     -- what was queried
  schema json,                     -- [{name, type, alias?}] of the table or first layer
  row_count bigint,
  sample json,                     -- up to 3 rows, values truncated, no geometry
  data_modified timestamp,         -- Esri editingInfo.lastEditDate (real data edit time), where exposed
  query_caps json,                 -- Esri: layer, layers, geometry_type, max_record_count, pagination, statistics, formats, extent
  error varchar,                   -- e.g. token required, service not started
  described_at timestamp
);
create or replace view v_resource_describe as
select r.id as resource_id, r.dataset_id, r.source_id, rd.*
from resources r join resource_describe rd on rd.key = case
  when r.datastore then 'datastore:' || r.source_id || '|' || regexp_extract(r.id, '[^|]+$')
  else lower(regexp_replace(r.url, '/+$', '')) end;

-- Raw HTTP probe log. One row per request; latest per (url, check) kept.
create table if not exists probes (
  url varchar,
  "check" varchar,                 -- root | robots | ckan | arcgis_hub | socrata | opendatasoft | dataverse | dkan | dcat
  status integer,
  final_url varchar,
  content_type varchar,
  server varchar,
  blocked varchar,                 -- null, or the kind of block detected (cloudflare_challenge, waf_403, ...)
  ms integer,
  error varchar,
  result json,                     -- parsed facts from the response
  fetched_at timestamp,
  primary key (url, "check")
);
`;

let instance: DuckDBInstance | undefined;

export async function db(): Promise<DuckDBConnection> {
  mkdirSync(join(ROOT, "db"), { recursive: true });
  instance ??= await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  await conn.run(SCHEMA);
  return conn;
}

export async function all<T = Record<string, unknown>>(conn: DuckDBConnection, sql: string, params?: Record<string, unknown>): Promise<T[]> {
  return serial(async () => (await conn.runAndReadAll(sql, params as never)).getRowObjectsJson() as T[]);
}

/** Insert-or-replace full rows via a temp NDJSON file, so nulls and nested JSON need no per-column binding. */
export async function upsert(conn: DuckDBConnection, table: string, rows: object[]): Promise<void> {
  if (!rows.length) return;
  return serial(() => upsertNow(conn, table, rows));
}

async function upsertNow(conn: DuckDBConnection, table: string, rows: object[]): Promise<void> {
  const file = join(tmpdir(), `codd-${table}-${randomUUID()}.jsonl`);
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    const cols = (await conn.runAndReadAll(`select column_name as name, data_type as type from information_schema.columns where table_name = '${table}' order by ordinal_position`)).getRowObjectsJson() as { name: string; type: string }[];
    // Read every column as JSON/VARCHAR-safe text, then let the INSERT cast to the table type.
    const spec = cols.map((c) => `'${c.name}': '${c.type === "JSON" ? "JSON" : "VARCHAR"}'`).join(", ");
    const select = cols.map((c) => `"${c.name}"::${c.type} as "${c.name}"`).join(", ");
    await conn.run(`insert or replace into ${table} select ${select} from read_json('${file}', format='newline_delimited', columns={${spec}})`);
  } finally {
    rmSync(file, { force: true });
  }
}

/** Bulk-load an NDJSON (optionally .gz) file into a table, casting each column to the table's type. */
export async function loadJsonl(conn: DuckDBConnection, table: string, file: string): Promise<number> {
  return serial(async () => {
    const cols = (await conn.runAndReadAll(`select column_name as name, data_type as type from information_schema.columns where table_name = '${table}' order by ordinal_position`)).getRowObjectsJson() as { name: string; type: string }[];
    const spec = cols.map((c) => `'${c.name}': '${c.type === "JSON" ? "JSON" : "VARCHAR"}'`).join(", ");
    const select = cols.map((c) => `"${c.name}"::${c.type} as "${c.name}"`).join(", ");
    const r = await conn.runAndReadAll(`insert or replace into ${table} select ${select} from read_json('${file}', format='newline_delimited', columns={${spec}}, maximum_object_size=67108864)`);
    return Number((r.getRowObjectsJson()[0] as { Count?: number })?.Count ?? 0);
  });
}

export interface OpenItem {
  kind: string;
  subject_type: string;
  subject_id: string | null;
  title: string;
  detail?: string | null;
  key?: string;
}

/** Open (or refresh) an item. Resolved/wontfix items are left alone so a re-probe doesn't reopen settled decisions. */
export async function openItem(conn: DuckDBConnection, item: OpenItem): Promise<void> {
  const id = [item.kind, item.subject_id ?? "project", item.key].filter(Boolean).join(":");
  const existing = await all<{ status: string; created_at: string }>(conn, `select status, created_at::varchar as created_at from open_items where id = $id`, { id });
  const now = new Date().toISOString();
  // Human decisions (resolved/wontfix) stick; "stale" items were auto-cleared by a re-probe and can reopen.
  if (existing[0] && !["open", "stale"].includes(existing[0].status)) return;
  const created_at = existing[0]?.created_at ?? now;
  await upsert(conn, "open_items", [
    { id, kind: item.kind, subject_type: item.subject_type, subject_id: item.subject_id, status: "open", title: item.title, detail: item.detail ?? null, resolution: null, created_at, updated_at: now },
  ]);
}

export async function observe(conn: DuckDBConnection, subject_type: string, subject_id: string, key: string, value: unknown, evidence?: string): Promise<void> {
  await upsert(conn, "observations", [{ subject_type, subject_id, key, value, evidence: evidence ?? null, observed_at: new Date().toISOString() }]);
}

/** Flush the WAL into the main file and release the lock, so the file can be copied or replaced. */
export async function closeDb(conn: DuckDBConnection): Promise<void> {
  await conn.run("checkpoint");
  conn.closeSync();
  instance?.closeSync();
  instance = undefined;
}
