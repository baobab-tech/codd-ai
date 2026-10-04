# CODD AI design

Status: discovery and profiling work; connectors, harvest and the MCP server are next. Last updated 2026-10-04. Current work queue: [NEXT.md](../NEXT.md). Reusing this for another directory: [REUSE.md](../REUSE.md).

## The directory

The Canadian Open Data Directory lists 253 organizations, not datasets. Each row is a portal (or a publisher inside a shared portal) with a self-reported dataset count. The counts sum to 104,617; the datasets live in the portals.

There is no API. The org list is a CSV embedded as a JS string in the site's SvelteKit bundle (`_app/immutable/chunks/*.js`). `pnpm sync` walks the bundle and extracts it, so a site rebuild changes the chunk hash but not the method. The bundle also links two Google Sheets (`1J85yJwtVKP9jDZKrQIDE_oTVK4Dxj76I`, `1yBEsUQ52j-uj61GJBsCwxAMqC5bRcCAp`), likely the upstream editing sheets.

### Platform labels, as published

| Directory label | Orgs | Datasets (self-reported) |
|---|---:|---:|
| CKAN | 49 | 50,018 |
| Other / NA | 35 | 35,240 |
| ArcGIS Hub | 148 | 12,095 |
| Dataverse | 2 | 3,641 |
| Socrata (Tyler) | 13 | 3,240 |
| Opendatasoft | 3 | 383 |
| DKAN, API-only | 3 | 0 reported |

The probe detects platforms through their APIs instead. Detected numbers, which differ from these labels, are in `pnpm digest`.

### Data quality issues in the directory

- 21 orgs have no English URL; 20 are Quebec orgs with a French URL only (used as fallback). City of Calgary has no URL at all.
- City of Shawinigan's URL points at the Rouyn-Noranda organization page.
- 45 orgs publish under another portal (Données Québec ×20, Columbia Basin Water Hub ×12, Niagara Open Data ×5, The Data Zone ×3, Region of Durham ×3, HRM, Borealis). Their datasets are a subset of the parent's, so summed counts double-count.
- Dataset counts are mostly dated 2025-02 and are NA for 46 orgs.
- Platform labels are inconsistent (`Opendatasoft` vs `Open Data Soft`, `Other` vs `other`, `NA`), and 13 are wrong according to the probe.

## Data model

1. **Organization**: a publisher, from the directory (`orgs`). Corrections go in `org_overrides`.
2. **Source**: one thing a connector can list, meaning a platform, a base URL and an optional scope. Examples: `ckan:www.donneesquebec.ca#organization:ville-de-laval`, `esri_rest:maps.banff.ca/arcgis/BanffOpenData`. Many orgs can share a source's parent portal. `org_sources` links orgs to sources.
3. **Dataset → Resource** (next): harvested from sources. A dataset has metadata (title, description, tags, licence, dates, spatial extent). A resource is a downloadable or queryable thing (CSV, GeoJSON, Feature Service, PDF, API).

Each source has an **archetype**, which describes how it is listed:

| Archetype | What it looks like | Connector |
|---|---|---|
| `platform_api` | CKAN, ArcGIS Hub, Socrata, Opendatasoft, Dataverse, GeoNetwork, DCAT `data.json` | one per platform |
| `known_api` | A public API that isn't a catalog platform (StatCan WDS, Red Deer) | one small connector each |
| `esri_rest` | An ArcGIS Server services directory without a Hub catalog | `arcgis_rest`, restricted to the folders in `recipe.folders` |
| `web_listing` | Static pages linking data files | `web_listing`: start URLs and link patterns from `recipe` |
| `js_app` | A client-side app; the data comes from a backend API found by inspecting network calls | reclassified once the API is found |
| `document_library` | Mostly PDFs or reports | `documents`: list now; extract, chunk and embed later |
| `not_data` | A program page, a link list, nothing harvestable | none (`wontfix` or a URL override) |

`sources.recipe` (JSON) holds whatever the connector needs beyond platform and URL: start URLs, link patterns, Esri folders, discovered endpoints.

Each resource has a **tier**, which describes what the MCP can do with it:

| Tier | Example | What the MCP can do |
|---|---|---|
| `live_query` | Socrata SODA, ArcGIS FeatureServer, CKAN DataStore, ODS Explore, StatCan WDS | Filter and aggregate server-side |
| `tabular_file` | CSV, XLSX, JSON, GeoJSON, Parquet | Download, load into DuckDB, query |
| `geo_file` | SHP zip, KML, GPKG | Load via DuckDB spatial |
| `document` | PDF, DOCX, HTML page | Extract text and tables, cite |
| `link_only` | Landing page, broken link, login wall | Return metadata and URL only |

A source can mix them: a CKAN portal whose resources are all PDFs is `platform_api` with `document` resources.

## What is recorded, and where

Everything lives in one DuckDB file, published as GitHub release assets (`pnpm db:pull` / `pnpm db:publish`). Git holds code and docs. Schema: `src/db.ts`.

| Table | Holds | Written by |
|---|---|---|
| `orgs` | The directory, exactly as published. Never hand-edited. | `pnpm sync` |
| `org_overrides` | Corrections to directory fields, with a note saying why (e.g. Regina → openregina.ca). Probe and connectors read these over `orgs`. | maintainers |
| `sources` | How to connect: `platform`, `base_url`, `scope`, `connector_id`, `archetype`, `recipe`, `status`, live `dataset_count`, `curated`. | probe, autoprofile, profile-source |
| `org_sources` | Which orgs a source serves (`primary` / `published_under`). | same |
| `connectors` | One per access method, shared by many sources. Status: planned / building / ready. | probe, profile-source |
| `observations` | Structured facts, one value per (subject, key): `access`, `robots`, `landing`, `api`, `autoprofile`, `html_blocked_api_ok`, `rate_challenge`. | probe, autoprofile |
| `open_items` | Work queue (see below). | probe, autoprofile, sessions |
| `findings` | Narrative discoveries, append-only, one quotable fact each. | `pnpm note` |
| `probes` | Raw evidence: every request, status, timing, block signature, parsed result. | probe, autoprofile |

`pnpm digest` collects aggregates, observations, open items and findings into one markdown input for the landscape report.

Harvested `datasets` and `resources` will go in the same DB. If it outgrows a single release asset, harvest data moves to per-source Parquet files next to it.

### Source status

`needs_profiling` (probe found no API) → `proposed` (autoprofile draft, awaiting review) or `needs_human` → `identified` (platform API confirmed) / `harvestable` (recipe confirmed) → `harvested`. Also `not_data`.

`curated = true` marks sources decided by profiling, whether auto-applied, proposed or set by hand. The probe never overwrites or relinks them. It only records what it sees for that org as an observation.

### Work queue (`open_items.kind`)

| Kind | Who resolves it |
|---|---|
| `needs_review` | A Claude session: verify, write the recipe, resolve. Escalate to `needs_human` if still unclear. |
| `needs_human` | A person: documents, pages with no data, Esri folder selection, unreachable sites. |
| `decision` | A person: project-level policy. |
| `blocker`, `dead_link`, `data_error`, `platform_mismatch`, `needs_profiling` | Generated by the probe. Anyone may fix and resolve them. Auto items go `stale` when a re-probe stops seeing them. |

`resolved` and `wontfix` carry a `resolution` and are never reopened automatically.

## Pipeline

1. **Sync** (`pnpm sync`): directory → `orgs`.
2. **Probe** (`pnpm probe`): reachability, TLS, bot-block signatures (with a pause-and-retry for WAF challenges and a browser-UA comparison), robots.txt AI-agent rules, then a platform fingerprint via API calls: CKAN, ArcGIS Hub (with DCAT feed fallback), Socrata, Opendatasoft, Dataverse, GeoNetwork, ArcGIS Server, DCAT `data.json`. `API_HOME` maps known front-end hosts to their API host. Writes `sources`, `org_sources`, `observations`, `open_items`, `probes`.
3. **Auto-profile** (`pnpm autoprofile`): for `needs_profiling` sources, reads the landing page and follows up to 4 same-host data pages. It fingerprints up to 4 linked hosts that look like portals, counts data, geo and document file links, tests API-looking links for JSON, and checks for script-heavy pages. Then it routes each source as below.
4. **Review**: `needs_review` items by a Claude session, `needs_human` items by a maintainer. `pnpm profile-source` records the result as a curated source.
5. **Harvest** (next): each source's connector writes `datasets` and `resources`, incrementally by modified date where the API supports it.
6. **Classify resources**: normalize formats, assign a tier, check link health.
7. **Index**: full-text search over datasets; embeddings later.
8. **Enrich** (later): sample tabular resources for schema and row counts; extract text and tables from documents.

### Auto-profile routing

| Result | Route |
|---|---|
| A known platform answers on a linked host that no other org uses | applied: curated source, status `identified` |
| A linked portal that other orgs also use (data.ontario.ca, open.canada.ca) | applied if the org is found inside it (CKAN `organization_autocomplete`); otherwise `needs_review` |
| ArcGIS Server with a folder named like open data | applied, recipe restricted to those folders |
| ArcGIS Server with no such folder | `needs_human`: which folders are open data? |
| JSON endpoints on data pages | `needs_review` (known_api) |
| 3+ data files, outnumbering documents | `needs_review` (web_listing, draft recipe) |
| 3+ documents, fewer data files | `needs_human` (document_library) |
| Script-heavy page (10+ scripts) or API-looking links, no data | `needs_review` (js_app: inspect with a browser) |
| Nothing found, or unreachable | `needs_human` |

Not yet checked by the auto-profile: `sitemap.xml`, CSW `GetCapabilities` on arbitrary hosts, OGC API `/collections`, GTFS feeds.

## Connectors (planned)

Each connector implements:

- `list_datasets(source) → iterator<Dataset>`, paged and incremental where possible
- `get_dataset(source, id) → Dataset`
- `query(resource, filters, fields, limit)` for `live_query` resources

| Connector | Listing | Live query |
|---|---|---|
| `ckan` | `/api/3/action/package_search?rows=1000&start=` (+ `fq` scope) | DataStore `datastore_search(_sql)` |
| `arcgis_hub` | `/api/search/v1/collections/dataset/items` or `/api/feed/dcat-us/1.1.json` | FeatureServer `/query` |
| `socrata` | `/api/catalog/v1?domains=<host>` | SODA `/resource/<id>.json?$where=` |
| `opendatasoft` | `/api/explore/v2.1/catalog/datasets` | Explore v2.1 `/records` |
| `dataverse` | `/api/search?type=dataset&per_page=1000` (+ `subtree` scope) | none (files) |
| `geonetwork` | CSW `GetRecords` or `/srv/api/search/records/_search` | none (links to services) |
| `dcat` | `data.json` | none |
| `arcgis_rest` | services directory, `recipe.folders` only | FeatureServer/MapServer `/query` |
| `statcan_wds` | `getAllCubesListLite` | vector and coordinate queries; full-table CSV |
| `web_listing` | crawl `recipe.start_urls`, match `recipe` patterns | none (files) |
| `figshare` | `api.figshare.com/v2` search | none (files) |

## MCP surface (draft)

TypeScript MCP server over the same DuckDB file.

- `search_datasets(query, province?, org?, format?, tier?, updated_after?)`
- `get_dataset(id)`: metadata, resources, tiers
- `list_publishers(filters)`: directory data
- `query_resource(resource_id, sql | filters)`: live API passthrough, or DuckDB over a cached download
- `preview_resource(resource_id, n)`: first rows and schema

## Decided

- TypeScript throughout (Node 22, pnpm, tsx); DuckDB as the store.
- One DuckDB file, published as GitHub release assets, outside git.
- Probe etiquette: one request at a time per host, 500 ms apart, an identifying user agent.

## Open questions

1. Does robots.txt `Disallow: /` apply to documented public APIs? (Dataverse defaults; tracked as `decision:project:robots_api`.)
2. open.canada.ca federates some provincial and municipal records. Dedupe against those portals, or treat it as one more catalog?
3. Send directory corrections (Calgary, Shawinigan, Regina, wrong labels) upstream to the Society?
4. MCP hosting: local stdio first, or remote from the start?
5. Where harvest data lives once it outgrows a release asset: R2/S3 or a Hugging Face dataset.
