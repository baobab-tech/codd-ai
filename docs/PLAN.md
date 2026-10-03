# CODD AI plan

Status: draft for iteration. Last updated 2026-10-03.

## What the directory is

The Canadian Open Data Directory lists 253 organizations, not datasets. Each row is a portal (or a sub-catalog inside one) with a self-reported dataset count. The counts sum to 104,617. The datasets themselves live in the portals.

Source: a CSV embedded as a JS string in the site's SvelteKit bundle (`_app/immutable/chunks/*.js`). There is no API. The bundle also links two Google Sheets (`1J85yJwtVKP9jDZKrQIDE_oTVK4Dxj76I`, `1yBEsUQ52j-uj61GJBsCwxAMqC5bRcCAp`), likely the upstream editing sheets. `scripts/sync_directory.py` re-extracts the CSV, so a site rebuild changes the chunk hash but not the method.

### Platform mix (directory labels)

| Platform | Orgs | Datasets (self-reported) |
|---|---:|---:|
| CKAN | 49 | 50,018 |
| Other / NA (unlabelled) | 35 | 35,240 |
| ArcGIS Hub | 148 | 12,095 |
| Dataverse | 2 | 3,641 |
| Socrata (Tyler) | 13 | 3,240 |
| Opendatasoft | 3 | 383 |
| DKAN, API-only | 3 | 0 reported |

Concentration: Government of Canada (CKAN, 34,844), Borealis (Dataverse, 21,755), Figshare (9,695), Abacus (Dataverse, 2,512). Four portals hold ~66% of all datasets.

Several "Other" entries are known platforms: Borealis is Dataverse, Figshare has a public API, data.ontario.ca and open.alberta.ca are CKAN, data.mississauga.ca is ArcGIS Hub. A probe step will relabel these.

### Data quality issues found

- 21 orgs have no English URL; 20 are Quebec orgs with a French URL only (now used as fallback). City of Calgary has no URL at all (it is `data.calgary.ca`, Socrata).
- City of Shawinigan's URL points at the Rouyn-Noranda organization page.
- 45 orgs publish *under* another portal (Données Québec ×20, Columbia Basin Water Hub ×12, Niagara Open Data ×5, The Data Zone ×3, Region of Durham ×3, HRM ×1, Borealis ×1). Their datasets are a subset of the parent's, so summed counts double-count.
- Dataset counts are mostly dated 2025-02 and are "NA" for 46 orgs.
- Platform labels are inconsistent (`Opendatasoft` vs `Open Data Soft`, `Other` vs `other`, `NA`).

## Data model

Three levels. The directory only gives us the first.

1. **Organization** — a publisher (City of Laval). From the directory.
2. **Catalog** — a harvestable endpoint with one platform and one API base (`https://www.donneesquebec.ca` CKAN, filtered to `organization:ville-de-laval`). Many orgs can share a catalog; a catalog has a connector.
3. **Dataset → Resource** — harvested from catalogs. A dataset has metadata (title, description, tags, license, dates, spatial extent); a resource is a downloadable or queryable thing (CSV, GeoJSON, Feature Service, PDF, API).

Queryability is a property of a resource, not a dataset. A tier per resource:

| Tier | Example | What the MCP can do |
|---|---|---|
| `live_query` | Socrata SODA, ArcGIS FeatureServer, CKAN DataStore, ODS Explore | Filter/aggregate server-side |
| `tabular_file` | CSV, XLSX, JSON, GeoJSON, Parquet | Download, load into DuckDB, query |
| `geo_file` | SHP zip, KML, GPKG | Load via DuckDB spatial |
| `document` | PDF, DOCX, HTML page | Extract text/tables, cite |
| `link_only` | Landing page, broken link, login wall | Return metadata and URL only |

## Storage

| What | Format | In git |
|---|---|---|
| Directory snapshot | `data/directory/directory.csv` | yes |
| Org + catalog registry | `registry/portals.jsonl` (later `registry/catalogs.jsonl`), hand-editable, one JSON per line | yes |
| Harvested datasets/resources | Per-catalog `jsonl.gz` shards under `data/harvest/<catalog>/` | no (too large; ~100k datasets × several KB); publish as a release or bucket artifact |
| Search index | One DuckDB file built from the shards: FTS over title/description/tags, filters on org, province, format, tier, updated date; vector column added later | no, rebuilt |

JSONL stays the source of truth so diffs are reviewable and any tool can read it. DuckDB is the query layer: it reads `jsonl.gz` directly, has FTS and spatial extensions, and the MCP can use the same engine to query downloaded CSV/Parquet.

Registry fields owned by the directory are overwritten on sync. Fields under `probe` and `connector` are ours and survive syncs.

## Connectors

One connector per platform, each implementing:

- `list_datasets(catalog) -> iterator[Dataset]` (paged, incremental by modified date where the API supports it)
- `get_dataset(catalog, id) -> Dataset`
- `query(resource, filters, fields, limit)` for `live_query` resources

Harvest endpoints, by coverage:

| Connector | Listing endpoint | Live query | Covers |
|---|---|---|---|
| CKAN | `/api/3/action/package_search?rows=1000&start=` | DataStore `datastore_search(_sql)` | open.canada.ca, Données Québec, Toronto, BC, Ontario, Alberta… |
| Dataverse | `/api/search?type=dataset&per_page=1000` | none (files) | Borealis, Abacus, U of T |
| ArcGIS Hub | `/api/feed/dcat-us/1.1.json` or `/api/search/v1/collections/dataset/items` | FeatureServer `/query` | 148 orgs |
| Socrata | `api.us.socrata.com/api/catalog/v1?domains=<host>` | SODA `/resource/<id>.json?$where=` | Edmonton, NS, Calgary… |
| Opendatasoft | `/api/explore/v2.1/catalog/datasets` | Explore v2.1 `/records` | 3 orgs |
| DCAT fallback | `/data.json`, `/catalog.jsonld`, sitemap | – | anything that exposes DCAT |
| Bespoke | per-site | – | Figshare API, Birds Canada, Marine Data BC, NWT Geomatics |

CKAN + Dataverse (incl. Borealis) + ArcGIS Hub + Socrata cover ~90% of reported datasets; Figshare adds another 9%.

## Pipeline

1. **Sync** — `scripts/sync_directory.py` pulls the directory into `registry/portals.jsonl`. Run on a schedule; diff shows added/removed orgs.
2. **Probe** — for each org URL: follow redirects, record final URL/status, fingerprint the platform from API endpoints (`/api/3/action/status_show`, `/api/info/version`, `/api/feed/dcat-us/1.1.json`, `/api/catalog/v1`, `/api/explore/v2.1`), derive the catalog base and org filter. Writes the `probe` field and proposes `catalogs.jsonl`.
3. **Harvest** — per catalog, run the connector and write `data/harvest/<catalog>/datasets.jsonl.gz`. Incremental on later runs.
4. **Classify resources** — format normalization, tier assignment, optional HEAD request for link health and content type.
5. **Index** — build the DuckDB file.
6. **Enrich (later)** — sample tabular resources for column names/types and row counts; extract PDF tables; embeddings for semantic search.

## MCP surface (draft)

- `search_datasets(query, province?, org?, format?, tier?, updated_after?)`
- `get_dataset(id)` — metadata, resources, tiers
- `list_publishers(filters)` — directory data
- `query_resource(resource_id, sql | filters)` — live API passthrough or DuckDB over a cached download
- `preview_resource(resource_id, n)` — first rows / schema

## Open questions

1. Language for connectors and MCP: Python (uv, DuckDB, httpx) or TypeScript (MCP SDK, deployable to Workers/Vercel)? The harvester and the MCP can differ.
2. Where harvest shards and the DuckDB index live: GitHub release assets, R2/S3, or Hugging Face dataset.
3. Federal portal (open.canada.ca, 34,844 datasets) also includes provincial/municipal federated records. Dedupe against those portals, or treat it as one more catalog?
4. Should corrections (Calgary URL, Shawinigan) be sent upstream to the Open Data Society?
5. Hosting: local stdio MCP first, or remote MCP from the start?

## Next steps

1. Write the probe script; run it over the 253 URLs (one GET per URL plus a few API fingerprint requests).
2. Build `catalogs.jsonl` from probe results; collapse the 45 "published under" orgs onto their parent catalogs.
3. CKAN connector first (open.canada.ca + Données Québec = ~36k datasets), then Dataverse, ArcGIS Hub, Socrata.
4. DuckDB index + a minimal stdio MCP with `search_datasets` and `get_dataset`.
