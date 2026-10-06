# How CODD AI works

The README has the short version. The data model and statuses are in [PLAN.md](PLAN.md), and forking for another directory is covered in [REUSE.md](../REUSE.md).

<p align="center"><img src="../assets/pipeline.svg" alt="CODD AI pipeline" width="100%"></p>

## Pipeline

1. **Sync** (`pnpm sync`). The directory has no API. Its org list is a CSV embedded in the site's JS bundle. The sync walks the bundle, extracts the CSV, and loads it into `orgs` unchanged. Corrections live in `org_overrides`, never in `orgs`.
2. **Probe** (`pnpm probe`). For each org URL: reachability, redirects, TLS, bot-protection signatures, and robots.txt rules for AI crawlers. Then it fingerprints the platform through its API, not the HTML: CKAN, ArcGIS Hub, ArcGIS Server, Socrata, Opendatasoft, Dataverse, GeoNetwork, DCAT. The result is a `sources` row (platform, API base, scope inside a shared portal, live dataset count). Problems become `open_items`.
3. **Auto-profile** (`pnpm autoprofile`). For orgs with no recognized API, it reads the landing page and a few data pages, and fingerprints the portals they link to. It counts data and document files and looks for JSON APIs. Each source then gets an archetype (`platform_api`, `known_api`, `esri_rest`, `web_listing`, `js_app`, `document_library`, `not_data`) and is routed to one of:
   - **applied**: a known platform answered; nothing to review.
   - **needs_review**: a Claude session verifies it (inspects a JS app in a browser, confirms a file listing, finds the org inside a shared portal).
   - **needs_human**: a person decides (document libraries, pages with no data, which ArcGIS folders are open data).
4. **Review** (`pnpm items`, `pnpm profile-source`). Reviewers confirm the archetype and write a `recipe` (JSON connector settings). Reviewed sources are marked `curated`, and the probe never overwrites them.
5. **Harvest** (`pnpm harvest`, `pnpm harvest:load`). One lister per platform fetches every catalog record into local shards (`data/harvest/<source>/`, raw platform records kept), then the load step writes `datasets` and `resources`. Each resource gets a tier: live query, tabular file, geo file, document, or link only. Each record gets a kind (data, document, app, image, inventory) and a licence class, and mirrored or repeated records are marked `duplicate_of`. Done for CKAN and ArcGIS Hub; the other platforms are next.
6. **MCP** (planned). A TypeScript MCP server for searching datasets, inspecting them, and querying resources, either live through the source API or through DuckDB over a downloaded file.

## Landscape analysis

Every step records what it learns about how agent-friendly Canadian open data is:

- `observations`: structured facts per org (access, robots.txt, API, landing page).
- `findings`: narrative discoveries, one quotable fact each, added with `pnpm note`.
- `open_items`: the work queue (blockers, dead links, wrong directory labels, `needs_review`, `needs_human`).
- `datasets` / `resources`: harvested records with AI-readiness fields, scored by the views `v_dataset_readiness` and `v_source_readiness` ([AI-READINESS.md](AI-READINESS.md)).

`pnpm digest` collects all of it into one markdown file, the input for the landscape report. `pnpm charts` draws the report's charts as SVG files in `reports/charts/`, from the same database. The current report is [reports/LANDSCAPE.md](../reports/LANDSCAPE.md).

## The database

All state lives in one DuckDB file, `db/codd.duckdb`. It is not committed. It is published as an asset on the [`db-latest` release](https://github.com/baobab-tech/codd-ai/releases/tag/db-latest), with a dated `db-YYYYMMDD-HHMMSS` release kept for each snapshot.

| Table | Holds |
|---|---|
| `orgs` | The directory, as published |
| `org_overrides` | Our corrections to directory fields, with reasons |
| `sources` / `org_sources` | How to connect to each data source, and which orgs it serves |
| `connectors` | Access methods, shared across sources |
| `observations` | Structured facts from probing |
| `findings` | Narrative discoveries |
| `open_items` | Work queue |
| `datasets` / `resources` | Harvested catalog records and their files or APIs |
| `probes` | Raw HTTP evidence |

Maintainers publish with `pnpm db:publish -m "what changed"`. Only one person or session should write at a time.

## Commands

| Command | Does |
|---|---|
| `pnpm sync` | Re-pull the directory into `orgs` |
| `pnpm probe [--only id,id]` | Probe org URLs and fingerprint platforms |
| `pnpm autoprofile [--only id,id] [--dry-run]` | Profile and route sources the probe couldn't identify |
| `pnpm items [kind]` | List the work queue; `pnpm items resolve <id> "why"` closes an item |
| `pnpm profile-source <org> ...` | Record a reviewed (curated) source |
| `pnpm note "..."` / `pnpm note --list` | Record or list findings |
| `pnpm harvest [--platform p] [--only id,id]` | Fetch catalogs into `data/harvest/` shards |
| `pnpm harvest:load [--only id,id]` | Load shards into `datasets` / `resources` and classify records (`--only none` reclassifies without reloading) |
| `pnpm digest [--out file]` | Landscape digest |
| `pnpm charts [--out dir]` | Landscape report charts (SVG) in `reports/charts/` |
| `pnpm sql "..."` | Ad-hoc SQL against the database |
| `pnpm db:pull` / `pnpm db:publish` | Download / publish the database |
| `pnpm db:export` / `pnpm db:import` | Optional JSONL copy of the small tables, for readable diffs |

## Crawling etiquette

The probe sends requests to a host one at a time, 500 ms apart, with a `codd-ai` user agent that links to this repository. A browser user agent is used only to test whether a block depends on the user agent, and that result is recorded. We read robots.txt and record its rules. robots.txt governs crawling web pages: documented public APIs and OAI-PMH endpoints are used even where robots.txt covers their paths, with the same identification and pacing (maintainer decision, 2026-10-06). A `Crawl-delay` is honoured.
