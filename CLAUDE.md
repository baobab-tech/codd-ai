# CODD AI

Registry, connectors and (later) an MCP server over the portals in the Canadian Open Data Directory. TypeScript (Node 22, pnpm, tsx); state lives in one DuckDB file.

## Start of session

```bash
pnpm install
pnpm db:pull        # latest published DB → db/codd.duckdb
```

Read `NEXT.md` for where work left off, and `docs/PLAN.md` for the data model and the plan for non-standard sources.

## State lives in the DB, not in git

`db/codd.duckdb` is gitignored. It is published as GitHub release assets: `pnpm db:publish -m "what changed"` updates the rolling `db-latest` release and adds a dated snapshot. One writer at a time: pull before working, publish when done. Query it with `pnpm sql "select ..."`.

Tables, by purpose (schema in `src/db.ts`):

- `orgs`: the directory as published. Never edit it. Put corrections in `org_overrides` (with a `note` saying why).
- `sources`: how to connect: `platform`, `base_url`, `scope`, `connector_id`, `archetype`, `recipe`, `status`.
- `observations`: structured facts refreshed by the probe (access, robots, landing, api).
- `open_items`: the work queue. Close items with `status='resolved'` or `'wontfix'` and a `resolution`.
- `findings`: narrative discoveries for the landscape report. Append-only.

## Record what you learn

Anything discovered in a session that a landscape report should mention goes into `findings`, before the session ends. This covers: how a portal really works, a blocker, a data-quality problem, a count that surprised us, an access pattern, a decision the maintainers made. One fact per finding, written so it can be quoted.

```bash
pnpm note --topic <topic> --subject <type:id> --evidence <url|query> "One fact."
pnpm note --list [--topic robots]
```

Topics: platforms, counts, reachability, bot_blocking, robots, data_quality, access_patterns, formats, licensing, connectors, decisions, other. Subject types: org, source, connector, platform, project.

Also: corrections → `org_overrides`; anything unresolved → `open_items`; how to connect → `pnpm profile-source` (writes `sources` with `archetype`, `recipe`, `curated=true`).

pnpm reserves some script names (`import`, `profile`, ...). Check with `pnpm <name>` before adding a script.

## Writing the landscape report

When asked for a report:

1. `pnpm digest --out reports/digest-$(date +%F).md` collects aggregates, observations, open items and every finding into one file.
2. Read the digest. Write the report to `reports/landscape-$(date +%F).md`. Default length is one page. It covers what the directory is, how agent-friendly the portals are (APIs vs. files vs. browser-only), what blocks agents, data quality, and the top recommendations.
3. Use only numbers that appear in the digest. Cite the subject for specific claims.

Follow the writing style in the user's global CLAUDE.md.

## Commands

| Command | Does |
|---|---|
| `pnpm sync` | Re-pull the directory into `orgs` |
| `pnpm probe [--only id,id]` | Fingerprint org URLs → `sources`, `observations`, `open_items`, `probes` |
| `pnpm note` | Record or list findings |
| `pnpm profile-source <org> --id --archetype --base-url [...]` | Record a profiled source (curated; the probe won't overwrite it) and close its needs_profiling item |
| `pnpm digest` | Report input digest |
| `pnpm sql "..."` | Ad-hoc SQL |
| `pnpm db:pull` / `db:publish` | Fetch / publish the DB |
| `pnpm db:export` / `db:import` | Optional JSONL round-trip of the small tables for a readable diff |

## Etiquette when probing

Requests to a host go one at a time, 500 ms apart, with a `codd-ai` user agent. A browser user agent is used only to test whether a block depends on the user agent, and the result is recorded. Ask the maintainer before any new bulk crawl.
