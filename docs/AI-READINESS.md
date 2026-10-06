# AI readiness: what we measure and where it is captured

CODD AI's analysis answers one question at three levels: **how well can an AI agent find, understand and use this data?** The levels are the portal (source), the dataset, and the directory as a whole. This file defines the dimensions, where each is recorded, and how the reports group them.

Everything listed here is captured as we go: by the probe, the auto-profile, the harvest and manual review. The landscape report (`reports/LANDSCAPE.md`) and later detailed reports read it back with SQL. Nothing needs re-crawling to produce a report.

## Portal (source) level

| Dimension | Question | Captured in |
|---|---|---|
| Catalog API | Can an agent list what the portal holds through an API? | `sources.archetype`, `sources.status`; view `v_source_readiness.catalog_api` |
| Access method | API, file listing, browser-only, documents, none | `sources.archetype` (`platform_api`, `known_api`, `esri_rest`, `web_listing`, `js_app`, `document_library`, `not_data`) |
| Reachability | Does the URL answer? Over HTTPS? Redirects, TLS errors, latency | `observations` key `access` |
| Bot walls | Is there a WAF challenge? Does it block the API too? | `observations` keys `access`, `html_blocked_api_ok`, `rate_challenge`; `probes.blocked` |
| AI crawler policy | Does robots.txt block AI crawlers or disallow everything? Content-Signal? | `observations` key `robots` |
| Live query | Can an agent filter or aggregate server-side (DataStore, SODA, FeatureServer, WDS)? | share of datasets with `best_tier = 'live_query'`; `v_source_readiness.share_live_query` |
| Directory accuracy | Is the directory's URL, platform and count right? | `open_items` kinds `dead_link`, `platform_mismatch`, `data_error`; `org_overrides`; `sources.dataset_count` against `orgs.dataset_count` |
| Shared hosting | Does the org publish inside another portal? | `org_sources.role`, `sources.parent_id`, `sources.scope` |

## Dataset level

Computed per dataset in view `v_dataset_readiness` (1 = yes), from columns the harvest fills on `datasets` and `resources`.

| Dimension | Rule | Source columns |
|---|---|---|
| Machine-readable | best resource is tabular, geo or live-query | `datasets.best_tier`, `resources.tier`, `resources.format` |
| Live query | at least one resource can be queried server-side | `best_tier = 'live_query'`, `resources.datastore` |
| Open licence | platform marks it open, or the licence names an open licence | `is_open`, `licence`, `licence_url` |
| Described | description of 100+ characters | `description` |
| Discoverable | 3+ tags or keywords | `tags`, `keywords` |
| Fresh | metadata modified in the last 12 months | `modified` |
| Themed | portal assigns at least one theme or subject | `themes` |
| Spatial | spatial extent or geographic coverage declared | `has_spatial` |
| Contact | maintainer or author listed | `has_contact` |
| Bilingual | title in English and French | `bilingual` |
| Update cadence | declared frequency | `frequency` |
| Access level | open, restricted, under review (where declared) | `access_level` |

Resource tiers: `live_query`, `tabular_file`, `geo_file`, `document`, `link_only` (`src/harvest/tier.ts`).

The harvest also keeps each platform's **raw record** (`data/harvest/<source>/raw.jsonl.gz`), so new dimensions can be derived later without fetching again.

## Narrative evidence

`findings` holds what the numbers can't say: how a portal really works, surprises, patterns, and decisions. Every session adds to it (`pnpm note`). Topics map onto report sections:

| Report section | Finding topics |
|---|---|
| Platforms and access | `platforms`, `access_patterns`, `connectors` |
| Barriers | `reachability`, `bot_blocking`, `robots` |
| Data quality | `data_quality`, `counts`, `formats` |
| Rights | `licensing` |
| Project choices | `decisions` |

## Grouping for reports

| Grouping | Field | Notes |
|---|---|---|
| Government level | `orgs.org_type` | municipal, provincial, federal, Indigenous, academic, non-profit |
| Geography | `orgs.province`, `orgs.region` | |
| Platform | `sources.platform` | |
| Access method | `sources.archetype` | |
| Theme | `datasets.themes` | Raw portal vocabularies for now. Planned: map them to one shared theme list (for example the 13 DCAT-AP data themes) in a `theme_map` table, and classify untagged datasets from title and description. |
| Format | `resources.format`, `resources.tier` | |
| Freshness | `datasets.modified` | by year |

## Report types this supports

- **Landscape (one page)**: directory-wide readiness, platforms, barriers, recommendations. `reports/LANDSCAPE.md`.
- **Detailed report**: per-dimension tables and charts by government level, province, platform and theme. Lists the most and least ready portals, with dataset-level distributions.
- **Per-portal scorecard**: one row per source from `v_source_readiness`, plus its findings and open items.
- **Visuals**: platform share, readiness by province (map), format mix, freshness histogram, the readiness funnel (listed → reachable → catalog API → machine-readable → live query).
