# Canadian Open Data Directory: landscape report

**As of 2026-10-06.** CODD AI checked all 253 organizations in the [Canadian Open Data Directory](https://directory.opendatasociety.ca/directory): reachability, bot protection, robots.txt, and which catalog API each portal actually runs. It then harvested the catalog records of the 12 CKAN portals and 131 ArcGIS Hub sites and scored each record for AI readiness. Every number below comes from [the digest for this date](digest-2026-10-06.md). The [2026-10-04 digest](digest-2026-10-04.md) covers the portal-level checks alone.

## Summary

- **The directory lists publishers, not datasets.** 253 organizations report 104,617 datasets between them. The counts are self-reported, mostly dated February 2025, and missing for 46 orgs.
- **89% of organizations have a source an agent can read.** 226 orgs have a working catalog API or a confirmed listing method. 15 are waiting on a human decision or a fix. 12 have a dead link or no URL.
- **Half of the harvested catalog records are data.** The CKAN and Hub catalogs hold 126,825 unique records: 63,124 data records (49.8%), 52,789 documents (41.6%), 7,041 single images (5.6%), 2,045 apps (1.6%) and 1,826 inventory entries for unreleased data (1.4%).
- **Most data records are machine-readable.** 76.2% of data records have a CSV, spreadsheet, GIS file or query API. 31.7% can be queried live, without downloading a file.
- **Licensing is the main gap on ArcGIS Hub.** 94.9% of CKAN data records carry an open licence, against 53.5% on Hub. 36.2% of Hub data records have no licence or only a link to a terms page.
- **Two platforms dominate.** ArcGIS Hub runs 138 orgs (54.5%). CKAN runs 51 orgs and holds most of the records, in federal and provincial portals.
- **Bot walls and robots.txt barely matter.** 20 orgs put their web pages behind an AWS WAF challenge, and their APIs answered anyway. 7 hosts block named AI crawlers; none names Claude's.

## Platforms

Detected through each portal's API, not the directory's label.

| Platform | Orgs | Share | Live records (probe) | Unique records harvested |
|---|---:|---:|---:|---:|
| ArcGIS Hub | 138 | 54.5% | 12,266 | 25,341 |
| CKAN | 51 | 20.2% | 149,357 | 101,484 |
| Socrata | 9 | 3.6% | 3,120 | not yet |
| DCAT `data.json` only | 4 | 1.6% | 423 | not yet |
| ArcGIS Server (no Hub) | 4 | 1.6% | 371 services | not yet |
| Dataverse | 3 | 1.2% | 27,255 | not yet |
| Opendatasoft | 2 | 0.8% | 226 | not yet |
| Custom API | 2 | 0.8% | 26 | not yet |
| GeoNetwork | 1 | 0.4% | 1,713 | not yet |
| GeoCore (geo.ca) | 1 | 0.4% | 103,388 | not yet |
| Bank of Canada Valet | 1 | 0.4% | 16,173 series | not yet |
| Statistics Canada WDS | 1 | 0.4% | 8,271 tables | not yet |
| OAI-PMH (FRDR) | 1 | 0.4% | not counted | not yet |
| Figshare | 1 | 0.4% | not counted | not yet |
| Not identified | 22 | 8.7% | — | — |
| No source | 12 | 4.7% | — | — |

Live counts come from each top-level portal's API at probe time, so publishers inside a shared portal are counted once. The Hub probe counted the `dataset` collection only; the harvest took every item, including documents and apps.

Harvested totals differ from live totals for two reasons:

- **Mirrors.** CanWIN (University of Manitoba) republishes the federal catalogue: 47,882 of its records carry open.canada.ca ids. Counting both portals adds about 48,000 records that aren't new.
- **Shared Hub items.** 2,588 ArcGIS items appear on more than one of 18 Hub sites. Kitchener, Waterloo and the Region of Waterloo, for example, show one shared catalogue.

GeoCore (103,388 records) overlaps heavily with open.canada.ca's geospatial holdings. The overlap will be measured when it is harvested.

## What the catalogs hold

### Record kinds

A catalog record is not always a dataset. Each harvested record gets a kind from the platform's own type field:

| Kind | Records | Share | Where |
|---|---:|---:|---|
| Data | 63,124 | 49.8% | Datasets with files or an API |
| Document | 52,789 | 41.6% | open.alberta.ca publications (34,479), open.canada.ca `info` records (10,144), Yukon reports, access-request and privacy-assessment summaries (3,369), Hub PDFs and document links (4,691) |
| Image | 7,041 | 5.6% | Single Hub image items, mostly orthophoto tiles: Township of Langley publishes 5,447 tiles as separate items, Grande Prairie 1,426 |
| App | 2,045 | 1.6% | Hub web maps, dashboards and pages (1,873) |
| Inventory | 1,826 | 1.4% | data.ontario.ca entries for data that is under review or restricted, with no files |

Kinds change the picture per portal. open.alberta.ca's 37,499 records hold 3,020 datasets, and those are 88% machine-readable. open.yukon.ca's 3,864 records hold 495 datasets. Readiness below is measured on data records only.

### Readiness of data records

| | All (63,124) | CKAN (51,388) | ArcGIS Hub (11,736) |
|---|---:|---:|---:|
| Machine-readable | 76.2% | 71.8% | 95.4% |
| Live-queryable | 31.7% | 19.6% | 84.7% |
| Open licence | 87.2% | 94.9% | 53.5% |
| Described (100+ characters) | 87.9% | 91.0% | 74.4% |
| 3+ tags or keywords | 90.6% | 92.5% | 82.4% |
| Themed | 74.9% | 83.2% | 38.3% |

Best way to get each data record:

| Best resource | Data records | Share |
|---|---:|---:|
| Tabular file (CSV, XLSX, JSON, XML, GeoJSON) | 23,846 | 37.8% |
| Live query API | 20,008 | 31.7% |
| Document only (PDF, HTML page) | 8,269 | 13.1% |
| Link with unknown content | 6,756 | 10.7% |
| GIS file (SHP, KML, GDB) | 4,170 | 6.6% |
| No resources | 75 | 0.1% |

Across all record kinds, PDF is the most common resource format (136,496 files), ahead of HTML pages (94,889) and CSV (58,745).

### Live query

Hub data is live-queryable by default: Feature Services answer queries. On CKAN, live querying depends on whether each portal loads its files into the DataStore:

| CKAN portal | Data records | In DataStore |
|---|---:|---:|
| data.cbwaterhub.ca | 449 | 75.3% |
| donnees.montreal.ca | 404 | 72.3% |
| Données Québec | 1,610 | 71.9% |
| CanWIN | 586 | 70.0% |
| Toronto | 554 | 58.3% |
| data.ontario.ca | 1,138 | 38.4% |
| BC Data Catalogue | 3,344 | 17.6% |
| open.alberta.ca | 3,016 | 10.1% |
| Niagara Open Data | 532 | 10.2% |
| open.canada.ca | 37,806 | 3.0% |
| openregina.ca | 1,379 | 1.8% |
| open.yukon.ca | 495 | 0% |

The catalogue API is open on every portal, with no key. open.canada.ca holds most CKAN data records, so its 3% pulls the CKAN average down. Some records offer another live API instead (WMS, Esri REST): 3,420 on open.canada.ca and 1,023 in BC.

### Licences

| Licence class | CKAN data | Hub data |
|---|---:|---:|
| Open | 94.9% | 53.5% |
| Terms page or unrecognized label | 0.2% | 20.1% |
| None | 1.2% | 16.1% |
| Non-commercial | 0.8% | 8.1% |
| Restricted (Crown copyright, access only) | 2.9% | 2.2% |

Licence labels are free text, so classifying them takes explicit rules. The same open licence appears as "CC BY 4.0", "Open Gov. License" or a bare URL. On Hub, many sites put a link to a terms-of-use page in the licence field (Strathcona County, Ottawa, Port Moody). An agent can't tell from the record whether those terms are open. Toronto leaves the licence field empty on 442 of its 555 records, so only 20% of its data records show an open licence through the API. BC marks 1,450 records "Access Only".

### Strong portals

These portals combine machine-readable formats, live query and open licences:

| Portal | Data records | Machine-readable | Live query | Open licence |
|---|---:|---:|---:|---:|
| Données Québec | 1,611 | 97% | 78% | 97% |
| donnees.montreal.ca | 405 | 95% | 73% | 98% |
| Niagara Open Data | 534 | 87% | 81% | 99% |
| Halifax (data-hrm) | 246 | 100% | 100% | 100% |
| Kingston | 246 | 100% | 100% | 100% |
| Ontario GeoHub (LIO) | 251 | 100% | 99% | 99% |

The other per-portal scores are in the [digest](digest-2026-10-06.md#readiness-by-harvested-source-unique-records-by-kind--of-its-data-records).

## Who is ready

Orgs with an identified source, by type:

| Type | Orgs | Ready |
|---|---:|---:|
| Municipal government | 155 | 140 |
| Provincial agency | 35 | 32 |
| Non-profit | 28 | 26 |
| Provincial / territorial government | 12 | 10 |
| Academia | 11 | 8 |
| National / federal government | 8 | 7 |
| Indigenous government | 2 | 2 |
| Crown corporation | 1 | 1 |
| Private | 1 | 0 |

Federal organizations run their own APIs instead of a catalog platform. Statistics Canada's Web Data Service lists 8,271 tables in one call, each downloadable whole or queryable by series. The Bank of Canada's Valet API serves 16,173 time series as JSON, CSV or XML. geo.ca sits on GeoCore. CMHC publishes inside open.canada.ca.

By province, Nova Scotia (10 of 10), Saskatchewan, the Northwest Territories and Yukon (3 of 3 each), Quebec (28 of 29) and BC (51 of 54) are nearly complete. New Brunswick (5 of 9), PEI (2 of 4) and Nunavut (0 of 1) have the most gaps.

## How the data is reached

| Access pattern | Sources | Examples |
|---|---:|---|
| Catalog platform API, harvested | 143 | 12 CKAN portals, 131 Hub sites |
| Catalog platform API, not yet harvested | 48 | Socrata, Dataverse, Opendatasoft, DCAT, GeoNetwork; orgs inside shared portals |
| Bespoke API | 5 | Statistics Canada WDS, Bank of Canada Valet, GeoCore, FRDR (OAI-PMH), Red Deer |
| Esri map server | 3 | Banff, Surrey, North Vancouver |
| Static page of data files | 11 | Saanich, Whitehorse, Tribunals Ontario, OEB, London Transit, Sault Ste. Marie |
| Blocked platform API | 2 | Hamilton (Cloudflare challenge), Quinte West (broken Hub catalogue) |
| Waiting on a human decision | 13 | Document collections, pages with no data, Capital Regional District's map server, CONP |

These patterns came up repeatedly:

- **The directory link is often a front end, not the portal.** City "open data" pages link out to a Hub site or a provincial CKAN. Gatineau, CMHC and Welland publish inside a shared portal (Données Québec, open.canada.ca, Niagara Open Data) while the directory points at their own web page.
- **A shared-portal link is often a reference, not the data.** Of 8 orgs whose pages linked to a shared portal or a file list, all 8 turned out to publish files on their own site.
- **Esri servers mix open and internal layers.** Banff publishes an open-data folder next to pothole, graffiti and fire-department services on the same public endpoint. The Capital Regional District has 202 services and no folder marked as open data.
- **Bespoke portals can be excellent.** Red Deer's custom portal has a paged JSON API for every dataset, but no fingerprint can find it. It turned up only by reading a dataset page.

## Barriers for agents

| Barrier | Orgs | Detail |
|---|---:|---|
| Dead link | 11 | Mostly deleted or renamed ArcGIS Hub sites (Brantford, Hastings County, Okotoks, Orangeville…), plus a Marine Data BC timeout |
| Bot challenge on web pages | 20 | AWS WAF on Données Québec and Figshare; APIs unaffected |
| Bot challenge on the API | 1 | Hamilton's Hub search API sits behind a Cloudflare challenge for every scripted client. Its data is also on a McMaster-hosted Hub, which is open |
| Broken catalog API | 1 | Quinte West's Hub search, DCAT feed and data.json all answer "Site catalog is not configured correctly" |
| TLS error | 1 | Canadian Space Agency serves an incomplete certificate chain; strict HTTP clients fail |
| Missing or wrong URL | 2 | Calgary has no URL; Shawinigan's points at Rouyn-Noranda |

Hub downloads of feature layers are generated on request: the first call answers HTTP 202, and the client has to poll until the file is ready.

## robots.txt and AI crawlers

- 18 hosts have no robots.txt.
- 4 disallow all crawlers: Borealis, Abacus and U of T Dataverse (the Dataverse default), plus PEI GIS. Their APIs answer anyway.
- 7 block named AI crawlers. Six are the Niagara group (Niagara Open Data, St. Catharines, Fort Erie, Lincoln, Niagara-on-the-Lake, Brock University), all blocking GPTBot, CCBot, Bytespider and Amazonbot. Birds Canada blocks Amazonbot.
- None names ClaudeBot or uses Content-Signal.

Whether a robots.txt `Disallow` should apply to a documented public API is an open project decision.

## Directory data quality

- 13 platform labels are wrong. For example, Guelph and Thunder Bay are labelled CKAN but run ArcGIS Hub. PEI, PEI Water Registry and Strathcona are labelled Socrata but run Hub. Kingston is labelled Opendatasoft but runs Hub. Yukon is labelled DKAN but runs CKAN.
- 45 orgs publish inside another portal (Données Québec ×20, Columbia Basin Water Hub ×12, Niagara ×5, others). Summing their counts double-counts datasets.
- Counts are stale. Regina moved to openregina.ca, which holds 1,379 records and is listed as NA. Niagara Open Data lists 3 and holds 534. CanWIN lists 496 and serves 48,761, of which 879 are its own.

## Recommendations

**For the directory**
1. Fix the 2 broken URLs, the 11 dead links and the 13 wrong labels. The list is in the [digest](digest-2026-10-06.md#open-items).
2. Replace self-reported dataset counts with counts from each portal's API, split into data and documents.
3. Record "publishes inside portal X" as a structured field, with the portal's publisher filter.
4. Link to the portal or its API, not to a city web page about open data.

**For publishers**
1. Put a licence on every record, in the licence field, as a name or a standard URL. A link to a terms page doesn't tell an agent whether the data is open.
2. Load tabular files into the CKAN DataStore. Données Québec and Montréal show it can cover over 70% of records; open.canada.ca covers 3%.
3. Keep publications and data apart with a record type, as open.alberta.ca and open.canada.ca do. Agents can then filter for data.
4. Publish tiled imagery as one image service or collection, not one catalog item per tile.
5. Keep the catalog API outside any bot wall, as Données Québec does.
6. Mark which ArcGIS Server folders are open data, and keep internal services off public endpoints.

**For agent builders**
1. Use catalog APIs, not web pages. CKAN and ArcGIS Hub alone cover 189 orgs.
2. Filter on record type: half of the catalog records are documents, images, apps or unreleased inventory.
3. Deduplicate: CanWIN mirrors open.canada.ca, and Hub items repeat across sites.
4. Treat the directory URL as a starting point. Follow links to the real portal.

## Open questions

- 13 sources need a human decision: document collections (Nanaimo, NL Statistics, MPHEC, Metrolinx, Birds Canada), pages with no data found (Brandon, GeoNB, Nunavut, PEI GIS, OCUL), the Capital Regional District's map server, CONP's restricted research data, and a third-party CFL API listing. They are listed in the [digest](digest-2026-10-06.md#open-items).
- Should robots.txt apply to documented public APIs? It decides whether the three Dataverse installs get harvested.
- How much of GeoCore's 103,388 records duplicates open.canada.ca?
- How fresh is the data? CKAN's `metadata_modified` isn't a signal: 47,516 of 101,484 records were modified in 2026, largely by portal-wide metadata updates. Freshness needs resource dates or declared frequency.

## Method

`pnpm sync` extracted the directory. `pnpm probe` checked every org URL, one request per host at a time, 500 ms apart, with an identifying user agent. It recorded status, redirects, TLS errors, bot-protection signatures and robots.txt, then queried known catalog APIs (CKAN, ArcGIS Hub and Server, Socrata, Opendatasoft, Dataverse, GeoNetwork, DCAT). `pnpm autoprofile` followed links from pages with no recognized API and classified them; the rest were profiled by hand. `pnpm harvest` fetched every catalog record from the CKAN and Hub sources and kept the raw platform records. `pnpm harvest:load` classified each record by kind, licence and best resource, and removed mirrored and repeated records. Readiness is computed in the views `v_dataset_readiness` and `v_source_readiness`; [docs/AI-READINESS.md](../docs/AI-READINESS.md) defines each measure. Full method: [docs/HOW-IT-WORKS.md](../docs/HOW-IT-WORKS.md). To regenerate the numbers, run `pnpm db:pull && pnpm digest`.
