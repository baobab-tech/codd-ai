import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const ROOT = new URL("..", import.meta.url).pathname;
export const DB_PATH = process.env.CODD_DB ?? join(ROOT, "db/codd.duckdb");

// Working state lives in DuckDB; `pnpm export` writes each table to registry/<table>.jsonl for git.
// Tables listed here are exported/imported in this order.
export const TABLES = ["orgs", "sources", "org_sources", "connectors", "open_items", "observations", "probes"] as const;

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

-- A thing we can point a connector at: a portal, a scoped slice of a portal, a document library, an API.
create table if not exists sources (
  id varchar primary key,
  kind varchar not null,           -- portal | portal_scope | document_library | api | website | dataset
  platform varchar,                -- detected: ckan | arcgis_hub | socrata | opendatasoft | dataverse | dkan | figshare | unknown
  base_url varchar not null,       -- API base or landing URL
  scope json,                      -- e.g. {"ckan_fq": "organization:ville-de-laval"}
  connector_id varchar,
  status varchar not null,         -- unprobed | identified | blocked | dead | needs_profiling | harvestable | harvested
  dataset_count integer,           -- live count from the platform API
  first_seen timestamp,
  last_probed timestamp,
  notes varchar
);

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
  kind varchar not null,           -- blocker | dead_link | unknown_platform | platform_mismatch | data_error | needs_profiling | question | decision
  subject_type varchar not null,   -- org | source | connector | project
  subject_id varchar,
  status varchar not null,         -- open | resolved | wontfix
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
  const r = await conn.runAndReadAll(sql, params as never);
  return r.getRowObjectsJson() as T[];
}

/** Insert-or-replace full rows via a temp NDJSON file, so nulls and nested JSON need no per-column binding. */
export async function upsert(conn: DuckDBConnection, table: string, rows: object[]): Promise<void> {
  if (!rows.length) return;
  const file = join(tmpdir(), `codd-${table}-${randomUUID()}.jsonl`);
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    const cols = await all<{ name: string; type: string }>(conn, `select column_name as name, data_type as type from information_schema.columns where table_name = '${table}' order by ordinal_position`);
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
  if (existing[0] && existing[0].status !== "open") return;
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
