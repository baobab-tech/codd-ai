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
export const TABLES = ["orgs", "org_overrides", "sources", "org_sources", "connectors", "open_items", "observations", "findings", "probes"] as const;

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
