# Next

Paused 2026-10-03.

## Decisions so far

- TypeScript for everything (Node 22, pnpm, tsx). The MCP server will be TypeScript.
- DuckDB (`db/codd.duckdb`, gitignored) holds working state. `pnpm db:export` writes every table to `registry/*.jsonl` (probes go to `data/probes/`) for git. `pnpm db:import` rebuilds the DB from those files.
- The model keeps three layers apart: org → source (catalog / portal scope / document library / API) → connector (one per platform, shared across sources). Dataset and resource records come later. Expect to iterate on this as we explore.
- `open_items` tracks what still needs figuring out: blockers, dead links, unknown platforms, platform mismatches, data errors, items needing profiling, questions.
- `observations` holds landscape facts for the agent-friendliness report: bot protection, robots.txt rules for AI bots, API availability, formats, licence.

## Done

- `pnpm sync` pulls the directory (CSV embedded in the site's JS bundle) into `orgs` and `data/directory/`. 253 orgs, 104,617 reported datasets.
- Schema in `src/db.ts`. HTTP helper with bot-block detection in `src/http.ts`.

## Next steps

1. Write `src/cli/probe.ts`. For each org URL: GET the root, fetch robots.txt once per host, and fingerprint the platform via its API (CKAN `status_show`/`package_search?rows=0`, ArcGIS Hub `/api/search/v1`, Socrata `/api/catalog/v1`, ODS `/api/explore/v2.1`, Dataverse `/api/search`, `/data.json`). Write `probes` and `sources`/`org_sources`, and open items for blocks, dead links, mismatches and unknowns. If a site blocks the default UA, retry with a browser UA and record that it did.
2. Review the probe results with Olivier, going through them gradually. Flag blockers.
3. Collapse the 45 "published under" orgs onto their parent sources (Données Québec, Columbia Basin Water Hub, …).
4. Seed `connectors` and build the CKAN connector first.
5. Profile the odd sources (PDF libraries, websites) one at a time with Olivier.

Known data errors: Calgary has no URL (should be data.calgary.ca, Socrata). Shawinigan's URL points to Rouyn-Noranda. See also `docs/PLAN.md`.
