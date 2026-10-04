# Next

Working log. Last updated 2026-10-04. Start a session with `pnpm install && pnpm db:pull`, then `pnpm items`.

## State

| Step | Status |
|---|---|
| Directory sync | Done. 253 orgs, 104,617 reported datasets. |
| Probe | Done (2026-10-04). Platform fingerprints for CKAN, ArcGIS Hub/Server, Socrata, ODS, Dataverse, GeoNetwork, DCAT. |
| Profiling | 5 sources profiled by hand (StatCan WDS, Marine Data BC GeoNetwork, Saanich, Banff, Red Deer). Auto-profile run on 36: 7 applied, 19 `needs_review`, 11 `needs_human`. |
| Sources | 210 orgs have an identified or harvestable source, 30 are in the review queue, 13 have a dead link or no URL. |
| Findings | 36 recorded (`pnpm note --list`). |
| Connectors, harvest, MCP | Not started. |

Latest DB: the `db-latest` release (`pnpm db:pull`).

## Queue

1. **needs_human (11), for the maintainers.** Run `pnpm items needs_human`.
   - Document-heavy sources: Birds Canada, Nanaimo, MPHEC, Metrolinx, NL Statistics. Ingest the documents, look elsewhere for data, or skip?
   - No data found: Brandon, GeoNB, Nunavut, PEI GIS.
   - Capital Regional District: which ArcGIS Server folders are open data?
   - OCUL: page unreachable.
2. **decision (1):** does robots.txt `Disallow` apply to public APIs (Dataverse defaults)?
3. **needs_review (19), a Claude session can work these.** Run `pnpm items needs_review`.
   - Browser inspections: Bank of Canada (Valet API), CFL (a publicapis.io link, likely not_data), CIHI, geo.ca, FRDR, CONP, NL Open Data, Gatineau, CMHC, Hamilton, Quinte West.
   - Org scopes inside shared portals: AMO and Tribunals Ontario (data.ontario.ca), Whitehorse and NWT Geomatics (open.canada.ca), Manitoba Land Initiative (data.winnipeg.ca, probably only a reference).
   - File listings to confirm: London Transit, OEB, Sault Ste. Marie.
4. **Probe items:** 12 dead links, 13 platform mismatches, 2 data errors (Calgary has no URL; Shawinigan's URL is wrong), 1 blocker (Canadian Space Agency TLS).
5. **Build the CKAN connector** and harvest into `datasets` / `resources`. Then ArcGIS Hub, Socrata, Dataverse, ODS, GeoNetwork, `arcgis_rest` (folder-restricted), StatCan WDS and `web_listing`.
6. **MCP server** (TypeScript) over the harvested tables.

## Log

- 2026-10-03: repo created; directory extraction; plan.
- 2026-10-04: TypeScript + DuckDB; DB published as release assets; probe over 253 orgs (WAF, TLS, robots.txt, bot-block handling); Regina override; findings table, `pnpm note`, `pnpm digest`; profiling pilot (5 sources) and curated sources; GeoNetwork and ArcGIS Server fingerprints; auto-profile with review routing; `pnpm items`; public-repo cleanup (README, MIT licence, REUSE.md).

## Gotchas

- pnpm reserves some script names (`import`, `profile`). That's why it's `db:import` and `profile-source`.
- `db:publish` tags snapshots to the second. Publish only from one machine or session at a time.
- `API_HOME` in `src/fingerprint.ts` maps front-end hosts to API hosts (open.canada.ca, Toronto).
- The probe re-derives non-curated sources and auto items on every run. Curated sources are only observed, never changed.
