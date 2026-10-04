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

- `pnpm probe` fingerprints every org URL. Results go to `probes`, `sources`, `org_sources`, `observations` and `open_items`. First full run: 2026-10-04. Findings are in the `findings` table (`pnpm note --list`). `pnpm digest` collects everything a report needs; see CLAUDE.md, "Writing the landscape report".
- `pnpm sql "<query>"` runs ad-hoc queries.
- `org_overrides` holds our corrections to directory fields; the probe uses them over `orgs`. First entry: Regina → https://openregina.ca/ (CKAN, 1,379 datasets).
- `sources.archetype` and `sources.recipe` record how to connect to non-standard sources. A re-probe preserves both. See "Non-standard sources" in `docs/PLAN.md`.

- Session discoveries are recorded with `pnpm note`, and CLAUDE.md requires it. This session's 22 findings are backfilled. `docs/LANDSCAPE.md` was removed; its content is now in `findings`.

## Probe behaviour

- Requests to one host run one at a time, 500 ms apart. Up to 8 orgs are probed in parallel.
- A WAF challenge (AWS 202, Cloudflare) gets a 10 s pause and a retry, then a retry with a browser UA. `blocker` is opened only when no API answers either.
- `API_HOME` in `src/cli/probe.ts` maps front-end URLs to their API host (open.canada.ca, Toronto).
- Re-probing an org marks its previous auto-generated items `stale`. They reopen if the problem is seen again. Items set to `resolved` or `wontfix` are left alone.

## Open items (2026-10-04)

needs_profiling 42 · dead_link 11 (Regina resolved) · platform_mismatch 12 · data_error 2 (Calgary no URL, Shawinigan wrong URL) · blocker 1 (CSA TLS)

## Next steps

1. Add the auto-profile pass for `needs_profiling` sources: sitemap, ArcGIS REST roots, CSW, OGC API, file-type counts. It proposes an archetype and a draft recipe.
2. Review with Olivier, gradually:
   - the 42 `needs_profiling` sources, starting with the big ones (StatCan, Marine Data BC GeoNetwork, NWT Geomatics, CIHI, Surrey, Hamilton);
   - the 12 dead links: find the new URLs or mark them `wontfix`;
   - whether to respect robots.txt `Disallow: /` for API endpoints (the Dataverse defaults).
3. Collapse the "published under" orgs. Données Québec is already scoped by CKAN `organization:`. Columbia Basin Water Hub, Niagara, Data Zone and Durham still need checking.
4. Add the CanWIN count check: are its 48k records really datasets?
5. Build the CKAN connector and harvest into `datasets` / `resources` tables. CKAN covers about 46 orgs.
6. Build the ArcGIS Hub connector next (132 orgs), then Socrata, Dataverse and ODS.
