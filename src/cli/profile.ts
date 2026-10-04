/**
 * Record the result of profiling an org's data source by hand or by an agent.
 * Creates (or updates) a curated source, links it to the org, drops the probe's web: placeholder,
 * and resolves the needs_profiling item. The probe never overwrites curated sources.
 *
 *   pnpm profile-source <org_id> --id geonetwork:soggy2.zoology.ubc.ca/geonetwork --archetype platform_api --platform geonetwork \
 *     --base-url https://... [--connector geonetwork] [--count 1713] [--status harvestable] [--kind portal] \
 *     [--recipe '{"csw":"..."}'] [--notes "..."] [--role primary]
 */
import { all, db, upsert } from "../db.js";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const orgId = args[0];
const id = opt("--id");
const archetype = opt("--archetype");
const baseUrl = opt("--base-url");
if (!orgId || orgId.startsWith("--") || !id || !archetype || !baseUrl) throw new Error("usage: pnpm profile <org_id> --id <source_id> --archetype <a> --base-url <url> [...]; see header");

const ARCHETYPES = ["platform_api", "known_api", "esri_rest", "web_listing", "js_app", "document_library", "not_data"];
if (!ARCHETYPES.includes(archetype)) throw new Error(`archetype must be one of ${ARCHETYPES.join(", ")}`);

const conn = await db();
if (!(await all(conn, "select 1 from orgs where id = $id", { id: orgId })).length) throw new Error(`no org ${orgId}`);
const prev = (await all<{ first_seen: string }>(conn, "select first_seen::varchar as first_seen from sources where id = $id", { id }))[0];
const now = new Date().toISOString();
const platform = opt("--platform") ?? "unknown";

await upsert(conn, "sources", [{
  id,
  kind: opt("--kind") ?? (archetype === "document_library" ? "document_library" : archetype === "web_listing" ? "website" : "api"),
  platform,
  base_url: baseUrl,
  scope: null,
  connector_id: archetype === "not_data" ? null : (opt("--connector") ?? (archetype === "platform_api" ? platform : archetype)),
  status: opt("--status") ?? (archetype === "not_data" ? "not_data" : "harvestable"),
  dataset_count: opt("--count") ? Number(opt("--count")) : null,
  first_seen: prev?.first_seen ?? now,
  last_probed: now,
  notes: opt("--notes") ?? null,
  parent_id: null,
  recipe: opt("--recipe") ? JSON.parse(opt("--recipe")!) : null,
  curated: true,
  archetype,
}]);

// Swap the probe's placeholder for the curated source.
const placeholders = await all<{ source_id: string }>(conn, "select os.source_id from org_sources os join sources s on s.id = os.source_id where os.org_id = $org and s.status = 'needs_profiling' and not coalesce(s.curated, false)", { org: orgId });
for (const p of placeholders) {
  await all(conn, "update open_items set status = 'resolved', resolution = $r, updated_at = now() where kind = 'needs_profiling' and subject_id = $sid and status in ('open', 'stale')", { r: `profiled as ${archetype} → ${id}`, sid: p.source_id });
  await all(conn, "delete from org_sources where org_id = $org and source_id = $sid", { org: orgId, sid: p.source_id });
  await all(conn, "delete from sources where id = $sid and id not in (select source_id from org_sources)", { sid: p.source_id });
}
await upsert(conn, "org_sources", [{ org_id: orgId, source_id: id, role: opt("--role") ?? "primary" }]);
const connectorId = opt("--connector") ?? (archetype === "platform_api" ? platform : archetype);
if (archetype !== "not_data" && !(await all(conn, "select 1 from connectors where id = $id", { id: connectorId })).length)
  await upsert(conn, "connectors", [{ id: connectorId, platform, status: "planned", description: null, notes: null }]);
console.log(`profiled ${orgId} → ${id} (${archetype}${placeholders.length ? `, replaced ${placeholders.map((p) => p.source_id).join(", ")}` : ""})`);
