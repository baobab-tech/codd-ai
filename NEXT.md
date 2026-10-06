# Next

Working log and hand-off. Last updated 2026-10-06. A new session should be able to continue from this file, `CLAUDE.md` and `docs/`.

## Start here

```bash
pnpm install
pnpm db:pull          # latest DB → db/codd.duckdb (≈1 GB unpacked; 169 MB download)
pnpm items            # open work queue
pnpm digest | less    # current numbers
```

Read, in order: `CLAUDE.md` (conventions, review rules, three parts), `docs/PLAN.md` (data model, statuses, routing), `docs/AI-READINESS.md` (what we measure and where it's stored). Latest numbers: `reports/digest-2026-10-06.md`.

Harvest shards (`data/harvest/<source>/` with mapped and **raw** platform records) are local and gitignored, and are **not** in the published DB. They exist on the machine that ran the harvest. Anywhere else, re-run `pnpm harvest` (minutes) before anything that needs raw records.

## State

| Area | Status |
|---|---|
| Directory sync | Done. 253 orgs, 104,617 reported datasets. |
| Probe | Done (2026-10-04, partial re-probes since). Fingerprints: CKAN, ArcGIS Hub, ArcGIS Server, Socrata, Opendatasoft, Dataverse, GeoNetwork, DCAT. |
| Sources | 210 orgs have an identified or harvestable source. 30 were in review: `needs_review` is now empty and `needs_human` holds 13. 13 orgs have a dead link or no URL. |
| Harvest: CKAN | 12 portals: 149,366 records, 101,484 unique (CanWIN mirrors open.canada.ca; handled via `recipe.mirrors`), 645,852 resources. |
| Harvest: ArcGIS Hub | 131 sites: 27,929 items, 25,341 unique (items repeated across sites are deduped by global item id). |
| Harvest: others | Not started: Socrata (7 sources), Dataverse (2), Opendatasoft (2), GeoNetwork (1), DCAT (4), ArcGIS Server (4), known APIs (StatCan WDS, BoC Valet, GeoCore, FRDR OAI-PMH, Red Deer), web listings (≈13 with recipes). |
| AI readiness | Views `v_dataset_readiness`, `v_source_readiness`; columns `licence_class`, `record_kind`, `best_tier`, `duplicate_of`, `extras`. Digest has dataset-level sections. |
| Findings | 69 (`pnpm note --list`). |
| Landscape report | `reports/LANDSCAPE.md` is from the 2026-10-04 digest (portal level only). **Stale**: refresh from `reports/digest-2026-10-06.md`. |
| Serve (connectors, MCP) | Not started. |
| Steward (maintenance agent) | Not started; sessions following `CLAUDE.md` do its job. |

Headline numbers (2026-10-06, unique data records):

| | CKAN (56,583) | ArcGIS Hub (18,777) |
|---|---|---|
| Machine-readable | 67.6% | 59.6% |
| Live-queryable | 18.5% (DataStore depends on the portal: Québec 72%, open.canada.ca 3%) | 53.0% (Feature Services) |
| Open licence | 92.2% | 70.2% (23.3% have no licence or only a terms link) |
| Described (100+ chars) | 90.3% | 54.3% |

## Next steps, in order

1. **Refresh the landscape report** (`reports/LANDSCAPE.md`) from `reports/digest-2026-10-06.md`, following "Writing the landscape report" in `CLAUDE.md`. Add a dataset-level section: data vs documents vs apps, machine-readable, live query and why (CKAN DataStore), licence classes, metadata quality, duplicates and mirrors, Alberta publications. Update the README table and badge.
2. **Prepare the `needs_human` brief for Olivier.** He asked for more information and links before deciding. Write `reports/NEEDS-HUMAN.md`: one entry per item with org, directory URL, what we found (pages and links checked, file counts, sample links), the options, and a recommendation. Source: `pnpm items needs_human`, `observations` key `autoprofile`, and each `sources.recipe`. Don't resolve any of these without his answer.
3. **Harvest the remaining platforms.** For each new lister, follow the pattern used for ArcGIS Hub:
   - write `src/connectors/list/<platform>.ts`, mapping to the same `datasets`/`resources` columns and keeping the raw record;
   - **validate on 3–6 sources first** (paging stability, duplicates, field coverage, licence and record-kind mapping), then run all;
   - register it in `LISTERS` in `src/cli/harvest.ts`; `pnpm harvest --platform <p>` then `pnpm harvest:load`;
   - record findings.

   Suggested order: Socrata (Discovery API `api/catalog/v1`), Dataverse (Search API; decide robots.txt first, see the decision item), Opendatasoft (Explore v2.1), GeoNetwork (CSW `GetRecords`), DCAT `data.json`, then `arcgis_rest` (folder-restricted), the known APIs, and `web_listing` from recipes.
4. **Theme normalization**: a `theme_map` table from portal themes to one shared list (for example the DCAT-AP data themes), plus classification of untagged records. Enables "readiness by theme".
5. **Resource-level checks** (sample): link health (HEAD), real content type, DataStore staleness, Hub download behaviour (HTTP 202 then poll).
6. **Probe items**: 11 dead links, 13 platform mismatches, 2 data errors (Calgary no URL; Shawinigan wrong URL), 3 blockers (Canadian Space Agency TLS, Hamilton Cloudflare challenge on its Hub API, Quinte West broken Hub catalogue).
7. **Serve** (Part 2): query connectors and the MCP server. Design in `docs/PLAN.md` ("Connectors", "MCP surface").

## Decisions and preferences (from Olivier)

- TypeScript; DuckDB published as GitHub release assets; one package for now, three parts kept separate in docs and code boundaries.
- Validate an approach on a few sources before running it on everything.
- Don't commit after every small change; commit at milestones or when asked. Publish the DB after data changes.
- `needs_human` items stay with Olivier. Give him links and evidence, not just titles.
- Capture everything relevant to AI readiness as you go (`docs/AI-READINESS.md`): structured data in tables, narrative in `findings`.
- The Society's name is **Canadian Open Data Society**. Baobab Tech "is providing technical leadership". Code is MIT, © Baobab Tech in `LICENSE` only.

## Log

- 2026-10-03: repo created; directory extraction; plan.
- 2026-10-04: TypeScript + DuckDB; DB published as release assets; probe over 253 orgs (WAF, TLS, robots.txt, bot blocks); Regina override; findings, `pnpm note`, `pnpm digest`; profiling pilot and curated sources; GeoNetwork and ArcGIS Server fingerprints; auto-profile with review routing; `pnpm items`; public-repo cleanup (README, MIT, REUSE.md); logo and pipeline diagram; first landscape report; README split with `docs/HOW-IT-WORKS.md`.
- 2026-10-06: three-part structure documented; CKAN harvest (`pnpm harvest`, `harvest:load`, raw shards); `datasets`/`resources` with AI-readiness fields; CanWIN mirror handling; readiness views and `docs/AI-READINESS.md`; `needs_review` cleared (19 profiled; `profile-source --replaces/--scope/--parent`); ArcGIS Hub harvest (stable paging, org names, cross-site dedupe); `licence_class` and `record_kind` for all records; `db:publish` compacts the DB; 33 new findings.

## Gotchas

- **pnpm reserved names**: `import`, `profile` and others are pnpm commands; hence `db:import` and `profile-source`. Check with `pnpm <name>` before adding a script.
- **zsh**: quote URLs containing `?` (glob), don't put commands in variables (`P="pnpm ..."` won't split; use a function), and `==` at the start of `echo` is special.
- **DuckDB JSON operators**: wrap `->>` in parentheses when combining with `and`, `=` or `is not null`, e.g. `(value->>'status')::int`.
- **One writer**: only one process can open `db/codd.duckdb` at a time. The harvest closes it while fetching (shards to disk), so you can run `pnpm sql` and `profile-source` during a harvest, but not during `harvest:load`.
- **Licence rules** live in SQL in `src/cli/harvest-load.ts` and rerun on every load. `pnpm harvest:load --only none` reclassifies without reloading shards.
- **ArcGIS Hub paging** must use `sortBy=properties.created`. The default ordering repeats and skips items.
- `db:publish` tags snapshots to the second and uploads a compacted copy. `API_HOME` in `src/fingerprint.ts` maps front-end hosts to API hosts.
- The probe never changes curated sources; it only records an observation for them.
