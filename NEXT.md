# Next

Working log. Last updated 2026-10-06. Start a session with `pnpm install && pnpm db:pull`, then `pnpm items`.

## State

| Step | Status |
|---|---|
| Directory sync | Done. 253 orgs, 104,617 reported datasets. |
| Probe | Done (2026-10-04). Platform fingerprints for CKAN, ArcGIS Hub/Server, Socrata, ODS, Dataverse, GeoNetwork, DCAT. |
| Profiling | 5 sources profiled by hand (StatCan WDS, Marine Data BC GeoNetwork, Saanich, Banff, Red Deer). Auto-profile run on 36: 7 applied, 19 `needs_review`, 11 `needs_human`. |
| Sources | 210 orgs have an identified or harvestable source, 30 are in the review queue, 13 have a dead link or no URL. |
| Findings | 68 recorded (`pnpm note --list`). |
| Landscape report | `reports/LANDSCAPE.md`, from `reports/digest-2026-10-04.md`. Due a refresh from `reports/digest-2026-10-06.md`, which adds dataset-level readiness. |
| AI readiness | Dimensions and capture map in `docs/AI-READINESS.md`; SQL views `v_dataset_readiness`, `v_source_readiness`. |
| Harvest | CKAN: 12 portals, 149,366 records, 101,484 unique (CanWIN mirror removed). ArcGIS Hub: 131 sites, 27,929 items, 25,341 unique (cross-site duplicates removed). Raw records kept in `data/harvest/`. Next: Socrata, Dataverse, ODS, GeoNetwork, DCAT, known APIs, web listings. |
| Serve (connectors, MCP) | Not started. |
| Project parts | Registry (Part 1, in progress), Serve (Part 2, planned), Steward (Part 3, planned). One package for now; boundaries in `docs/PLAN.md`. |

Latest DB: the `db-latest` release (`pnpm db:pull`).

## Queue

1. **needs_human (13), for the maintainers.** Run `pnpm items needs_human`.
   - Document-heavy sources: Birds Canada, Nanaimo, MPHEC, Metrolinx, NL Statistics.
   - No data found: Brandon, GeoNB, Nunavut, PEI GIS; OCUL unreachable.
   - Capital Regional District: which ArcGIS Server folders are open data?
   - CONP: research data with ethics-approval terms. Include?
   - CFL: third-party, key-gated API. Skip?
2. **decision (1):** does robots.txt `Disallow` apply to public APIs (Dataverse defaults)?
3. **needs_review:** empty (worked 2026-10-06; 19 sources profiled).
4. **Harvest the other platforms:** Socrata, Dataverse, Opendatasoft, GeoNetwork, DCAT, then known APIs (StatCan WDS, Valet, GeoCore, OAI-PMH) and `web_listing` sources from their recipes.
5. **Refresh `reports/LANDSCAPE.md`** with dataset-level readiness.
6. **Theme normalization** (`theme_map`), per `docs/AI-READINESS.md`.
7. **Probe items:** 11 dead links, 13 platform mismatches, 2 data errors, 3 blockers (CSA TLS, Hamilton Cloudflare, Quinte West broken Hub).
8. **Serve:** connectors (query side) and the MCP server.

## Log

- 2026-10-03: repo created; directory extraction; plan.
- 2026-10-04: TypeScript + DuckDB; DB published as release assets; probe over 253 orgs (WAF, TLS, robots.txt, bot-block handling); Regina override; findings table, `pnpm note`, `pnpm digest`; profiling pilot (5 sources) and curated sources; GeoNetwork and ArcGIS Server fingerprints; auto-profile with review routing; `pnpm items`; public-repo cleanup (README, MIT licence, REUSE.md); logo and pipeline diagram; first landscape report (`reports/LANDSCAPE.md`); README split into a short landing page plus `docs/HOW-IT-WORKS.md`.
- 2026-10-06: three-part structure documented; CKAN harvest (`pnpm harvest`, `harvest:load`, raw shards); `datasets`/`resources` tables with AI-readiness fields; mirror handling (CanWIN); readiness views and `docs/AI-READINESS.md`; `needs_review` queue cleared (19 profiled, `profile-source --replaces/--scope/--parent`); 23 new findings. ArcGIS Hub harvest (stable paging via sortBy=properties.created, org-name lookup, cross-site dedupe by item id), `licence_class` and `record_kind` classification for all records; 9 more findings.

## Gotchas

- pnpm reserves some script names (`import`, `profile`). That's why it's `db:import` and `profile-source`.
- `db:publish` tags snapshots to the second. Publish only from one machine or session at a time.
- `API_HOME` in `src/fingerprint.ts` maps front-end hosts to API hosts (open.canada.ca, Toronto).
- The probe re-derives non-curated sources and auto items on every run. Curated sources are only observed, never changed.
