# CODD AI

Canada Open Data Directory AI: a registry, connectors, and an MCP server over the portals listed in the [Canadian Open Data Directory](https://directory.opendatasociety.ca/directory) (253 organizations, ~104k datasets).

## Layout

- `src/db.ts` — DuckDB schema: orgs, sources, org_sources, connectors, open_items, observations, probes
- `src/cli/` — sync, probe, and DB publish/pull commands
- `data/directory/` — raw CSV snapshot of the directory
- `docs/PLAN.md` — data model, storage, connectors, pipeline
- `NEXT.md` — where work left off
- `CLAUDE.md` — session conventions: record findings, generate reports
- `reports/` — digests and landscape reports

## Usage

The DuckDB file is not in git. It is published as a GitHub release asset (`db-latest` plus dated `db-*` snapshots).

```bash
pnpm install
pnpm db:pull          # fetch the latest published DB
pnpm sync             # re-pull the directory into orgs
pnpm db:publish -m "what changed"
```
