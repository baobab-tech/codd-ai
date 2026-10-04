# Next

Paused 2026-10-04. Start with `pnpm install && pnpm db:pull`.

## Decisions so far

- TypeScript for everything (Node 22, pnpm, tsx). The MCP server will be TypeScript.
- One DuckDB file (`db/codd.duckdb`, gitignored) is the source of truth for all state: registry, status, probes, and later the harvest. Git holds code and docs only.
- The DB is published separately from commits, as GitHub release assets:
  - `pnpm db:pull [tag]` downloads `db-latest`, or a dated tag, into `db/`. The previous local copy is kept as `db/codd.duckdb.bak`. Run it before starting work.
  - `pnpm db:publish -m "note"` checkpoints, gzips, and uploads. It replaces the asset on the rolling `db-latest` release and creates a dated `db-YYYYMMDD-HHMM` snapshot release, with table row counts in the notes.
  - One writer at a time: the last publish wins, and nothing is merged.
  - `pnpm db:export` / `pnpm db:import` are optional. They round-trip the small tables through `registry/*.jsonl` when a readable diff is wanted.
- The model keeps three layers apart: org → source (catalog / portal scope / document library / API) → connector (one per platform, shared across sources). Dataset and resource records come later. Expect to iterate on this as we explore.
- `open_items` tracks what still needs figuring out: blockers, dead links, unknown platforms, platform mismatches, data errors, items needing profiling, questions.
- `observations` holds landscape facts for the agent-friendliness report: bot protection, robots.txt rules for AI bots, API availability, formats, licence.

## Done

- `pnpm sync` pulls the directory (CSV embedded in the site's JS bundle) into `orgs` and `data/directory/`. 253 orgs, 104,617 reported datasets.
- Schema in `src/db.ts`. HTTP helper with bot-block detection in `src/http.ts`.
- First DB published: `db-20261004-1706` (253 orgs, other tables empty).

## Next steps

1. Write `src/cli/probe.ts`. For each org URL: GET the root, fetch robots.txt once per host, and fingerprint the platform via its API (CKAN `status_show`/`package_search?rows=0`, ArcGIS Hub `/api/search/v1`, Socrata `/api/catalog/v1`, ODS `/api/explore/v2.1`, Dataverse `/api/search`, `/data.json`). Write `probes` and `sources`/`org_sources`, and open items for blocks, dead links, mismatches and unknowns. If a site blocks the default UA, retry with a browser UA and record that it did.
2. Review the probe results with Olivier, going through them gradually. Flag blockers.
3. Collapse the 45 "published under" orgs onto their parent sources (Données Québec, Columbia Basin Water Hub, …).
4. Seed `connectors` and build the CKAN connector first.
5. Profile the odd sources (PDF libraries, websites) one at a time with Olivier.

Known data errors: Calgary has no URL (should be data.calgary.ca, Socrata). Shawinigan's URL points to Rouyn-Noranda. See also `docs/PLAN.md`.
