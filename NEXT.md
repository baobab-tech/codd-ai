# Next

Working log and hand-off. Last updated 2026-10-06. A new session should be able to continue from this file, `CLAUDE.md` and `docs/`.

## Start here

```bash
pnpm install
pnpm db:pull          # latest DB → db/codd.duckdb (≈1 GB unpacked; 169 MB download)
pnpm items            # open work queue
pnpm digest | less    # current numbers
```

Read, in order: `CLAUDE.md` (conventions, review rules, three parts), `docs/PLAN.md` (data model, statuses, routing), `docs/AI-READINESS.md` (what we measure and where it's stored). Latest numbers: `reports/digest-2026-10-06.md` and `reports/LANDSCAPE.md`.

Harvest shards (`data/harvest/<source>/` with mapped and **raw** platform records) are local and gitignored, and are **not** in the published DB. They exist on the machine that ran the harvest. Anywhere else, re-run `pnpm harvest` (minutes) before anything that needs raw records.

## State

| Area | Status |
|---|---|
| Directory sync | Done. 253 orgs, 104,617 reported datasets. |
| Probe | Done (2026-10-04, partial re-probes since). Fingerprints: CKAN, ArcGIS Hub, ArcGIS Server, Socrata, Opendatasoft, Dataverse, GeoNetwork, DCAT. |
| Sources | 236 orgs have an identified source; 3 are blocked (Hamilton, Quinte West, Abacus); 1 is not a data source (CFL); 13 have a dead or wrong link. `needs_human` and `decision` queues are empty. |
| Harvest: CKAN | 12 portals: 149,366 records, 101,484 unique (CanWIN mirrors open.canada.ca; handled via `recipe.mirrors`), 645,852 resources. |
| Harvest: ArcGIS Hub | 136 sites: 28,448 items, 25,860 unique (items repeated across sites are deduped by global item id). |
| Harvest: others | Done (2026-10-06/08): Borealis 24,661 (591,742 files), GeoCore 103,387 (95,750 radar scenes = images; 7,583 mirror open.canada.ca), StatCan WDS 8,270, Socrata 5,564 (6 portals), Valet 2,549, web listings 2,247 (18), GeoNetwork 1,713, FRDR 860, bespoke APIs 816, ArcGIS Server 725 layers, Opendatasoft 226. Total 270,779 unique records, 109,724 data. Abacus not harvested (bot-blocked). |
| Describe | `pnpm describe`: 14,984 DataStore tables (86.4% readable) and 14,237 Esri layers (89.1%) in `resource_describe`; 769M rows. Results file `data/describe/results.jsonl` (local, resumable). |
| AI readiness | Views `v_dataset_readiness`, `v_source_readiness` (shares over data records only, counts by kind); columns `licence_class`, `record_kind` (data, document, app, image, inventory), `best_tier`, `duplicate_of`, `extras`. |
| Findings | 112 (`pnpm note --list`). |
| Landscape report | `reports/LANDSCAPE.md` from `reports/digest-2026-10-08.md`: all platforms, describe pass, 10 SVG charts (`pnpm charts`). README table and badge match. |
| Serve (connectors, MCP) | Not started. |
| Steward (maintenance agent) | Not started; sessions following `CLAUDE.md` do its job. |

Headline numbers (2026-10-06, unique data records; images, documents, apps and inventory excluded):

| | CKAN (51,388) | ArcGIS Hub (11,823) |
|---|---|---|
| Machine-readable | 71.8% | 95.4% |
| Live-queryable | 19.6% (DataStore depends on the portal: Québec 72%, open.canada.ca 3%) | 84.9% (Feature Services) |
| Open licence | 94.9% | 53.8% (35.9% have no licence or only a terms link) |
| Described (100+ chars) | 91.0% | 74.1% |

## Next steps, in order

1. **Theme normalization**: a `theme_map` table from portal themes to one shared list (for example the DCAT-AP data themes), plus classification of untagged records. Enables "readiness by theme".
2. **Resource-level checks** (sample): link health (HEAD), real content type, DataStore staleness, Hub download behaviour (HTTP 202 then poll).
3. **Probe items**: re-check the 13 orgs with no source and the 15 web-listing orgs with the Hub `collections/all` fallback (Nanaimo and four 'DCAT' sources were missed this way; small crawl, ask first). Find Campbell River's own portal (lead in its data_error item). Then 11 dead links, 8 platform mismatches (North Vancouver may hide a Hub), 3 data errors (Calgary no URL, Shawinigan and Campbell River wrong URL), 4 blockers (Canadian Space Agency TLS, Hamilton Cloudflare challenge, Quinte West broken Hub catalogue, Abacus bot block).
4. **Browser fetcher** for sources behind a bot challenge or built in the browser (Nunavut Bureau of Statistics behind Cloudflare; Brandon and Metrolinx worked around via API and embedded JSON).
5. **Serve** (Part 2): query connectors and the MCP server. Design in `docs/PLAN.md` ("Connectors", "MCP surface").

## Decisions and preferences (from Olivier)

- TypeScript; DuckDB published as GitHub release assets; one package for now, three parts kept separate in docs and code boundaries.
- Validate an approach on a few sources before running it on everything.
- Early design: change the schema, kinds and views when the data shows they're wrong, but keep it simple. Ask when a structural change isn't obvious.
- Licences are counted as the API shows them; a portal-wide licence missing from the record doesn't count.
- Don't commit after every small change; commit at milestones or when asked. Publish the DB after data changes.
- `needs_human` items stay with a maintainer. Check them first, then ask in the session with links, evidence and a recommendation. No brief files.
- Capture everything relevant to AI readiness as you go (`docs/AI-READINESS.md`): structured data in tables, narrative in `findings`.
- The Society's name is **Canadian Open Data Society**. Baobab Tech "is providing technical leadership". Code is MIT, © Baobab Tech in `LICENSE` only.

## Log

- 2026-10-03: repo created; directory extraction; plan.
- 2026-10-04: TypeScript + DuckDB; DB published as release assets; probe over 253 orgs (WAF, TLS, robots.txt, bot blocks); Regina override; findings, `pnpm note`, `pnpm digest`; profiling pilot and curated sources; GeoNetwork and ArcGIS Server fingerprints; auto-profile with review routing; `pnpm items`; public-repo cleanup (README, MIT, REUSE.md); logo and pipeline diagram; first landscape report; README split with `docs/HOW-IT-WORKS.md`.
- 2026-10-06: three-part structure documented; CKAN harvest (`pnpm harvest`, `harvest:load`, raw shards); `datasets`/`resources` with AI-readiness fields; CanWIN mirror handling; readiness views and `docs/AI-READINESS.md`; `needs_review` cleared (19 profiled; `profile-source --replaces/--scope/--parent`); ArcGIS Hub harvest (stable paging, org names, cross-site dedupe); `licence_class` and `record_kind` for all records; `db:publish` compacts the DB; 33 new findings.
- 2026-10-06 (later): record kinds `image` (Hub image items, mostly orthophoto tiles) and `inventory` (data.ontario.ca unreleased entries); Yukon reports, access-request and PIA summaries reclassified as documents; readiness views and digest now measure data records only; landscape report refreshed with dataset-level sections; CLAUDE.md "Design stance".
- 2026-10-06 (evening): all 13 `needs_human` items and the robots.txt decision settled with Olivier in session (no brief files; evidence gathered first by read-only agents); Nanaimo Hub found and harvested; Hub fingerprint falls back to `collections/all`; robots parser distinguishes allowlists from blanket blocks; `pnpm charts` (SVG charts in `reports/charts/`); non-open sources are indexed as metadata only.
- 2026-10-06/08: listers for every platform (Socrata, Dataverse, Opendatasoft, GeoNetwork, ArcGIS Server per layer, StatCan WDS, Valet, GeoCore, OAI-PMH, web listings, bespoke APIs); `pnpm describe` (schema, row counts, samples, edit dates); Dataverse page cache (resumable); Abacus flagged bot-blocked; GeoCore radar scenes as images; licence fixes (Dataverse facet names, NatureCounts URL); report rewritten for all platforms with 10 charts.

## Gotchas

- **pnpm reserved names**: `import`, `profile` and others are pnpm commands; hence `db:import` and `profile-source`. Check with `pnpm <name>` before adding a script.
- **zsh**: quote URLs containing `?` (glob), don't put commands in variables (`P="pnpm ..."` won't split; use a function), and `==` at the start of `echo` is special.
- **DuckDB JSON operators**: wrap `->>` in parentheses when combining with `and`, `=` or `is not null`, e.g. `(value->>'status')::int`.
- **One writer**: only one process can open `db/codd.duckdb` at a time. The harvest closes it while fetching (shards to disk), so you can run `pnpm sql` and `profile-source` during a harvest, but not during `harvest:load`.
- **Licence rules** live in SQL in `src/cli/harvest-load.ts` and rerun on every load. `pnpm harvest:load --only none` reclassifies without reloading shards.
- **ArcGIS Hub paging** must use `sortBy=properties.created`. The default ordering repeats and skips items.
- `db:publish` tags snapshots to the second and uploads a compacted copy. `API_HOME` in `src/fingerprint.ts` maps front-end hosts to API hosts.
- The probe never changes curated sources; it only records an observation for them.
