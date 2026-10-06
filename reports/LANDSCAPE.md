# Canadian Open Data Directory: landscape report

**As of 2026-10-04.** CODD AI checked all 253 organizations in the [Canadian Open Data Directory](https://directory.opendatasociety.ca/directory) with 1,944 HTTP requests: reachability, bot protection, robots.txt, and which catalog API each portal actually runs. Every number below comes from [the digest for this date](digest-2026-10-04.md).

## Summary

- **The directory lists publishers, not datasets.** 253 organizations report 104,617 datasets between them. The counts are self-reported, mostly dated February 2025, and missing (NA) for 46 orgs.
- **83% of organizations can be read by an agent today.** 210 orgs have a source with a working catalog API or a confirmed listing method. 30 (11.9%) are still being profiled. 13 (5.1%) have a dead link or no URL.
- **The live catalogs hold about twice what the directory reports.** Their APIs return 203,028 records. Two sources account for much of the gap and need checking: CanWIN (48,773 records against 496 listed) and open.alberta.ca (37,496, many of them PDF publications).
- **Two platforms dominate.** ArcGIS Hub runs 136 orgs (53.8%) but holds only 12,266 datasets. CKAN runs 52 orgs and holds 149,357, concentrated in federal and provincial portals.
- **Bot walls barely matter.** 20 orgs put their web pages behind an AWS WAF challenge: the 19 Données Québec publishers and Figshare. The APIs behind those pages answered every request.
- **robots.txt rarely targets AI crawlers.** 7 hosts block named AI crawlers, and none names Claude's crawlers.

## Platforms

Detected through each portal's API, not the directory's label.

| Platform | Orgs | Share | Live records |
|---|---:|---:|---:|
| ArcGIS Hub | 136 | 53.8% | 12,266 |
| CKAN | 52 | 20.6% | 149,357 |
| Socrata | 10 | 4.0% | 3,120 |
| DCAT `data.json` only | 4 | 1.6% | 423 |
| ArcGIS Server (no Hub) | 4 | 1.6% | 371 services |
| Dataverse | 3 | 1.2% | 27,255 |
| Opendatasoft | 2 | 0.8% | 226 |
| GeoNetwork | 1 | 0.4% | 1,713 |
| Statistics Canada WDS | 1 | 0.4% | 8,271 tables |
| Figshare | 1 | 0.4% | not counted |
| Custom API (Red Deer) | 1 | 0.4% | 26 |
| Not yet identified | 25 | 9.9% | — |
| No source | 13 | 5.1% | — |

Live record counts come from the top-level portals, so publishers inside a shared portal are counted once. The largest are open.canada.ca (47,964), CanWIN (48,773), open.alberta.ca (37,496) and Borealis (24,632).

## Who is ready

Orgs with an identified source, by type:

| Type | Orgs | Ready |
|---|---:|---:|
| Municipal government | 155 | 135 |
| Provincial agency | 35 | 27 |
| Non-profit | 28 | 23 |
| Provincial / territorial government | 12 | 10 |
| Academia | 11 | 8 |
| National / federal government | 8 | 4 |
| Indigenous government | 2 | 2 |
| Crown corporation / private | 2 | 1 |

Federal organizations are the least ready: 4 of 8. Statistics Canada, the Bank of Canada, CMHC and geo.ca each run their own API or download pages instead of a catalog platform. Statistics Canada's Web Data Service is still among the most usable sources found: one call lists 8,271 tables, and each can be downloaded whole or queried by series.

By province, BC (51 of 54), Nova Scotia (10 of 10), Quebec (27 of 29) and Saskatchewan (3 of 3) are nearly complete. New Brunswick (5 of 9), Newfoundland and Labrador (2 of 4), PEI (2 of 4) and Nunavut (0 of 1) have the most gaps.

## How the data is reached

| Access pattern | Sources | Examples |
|---|---:|---|
| Catalog platform API, identified | 187 | open.canada.ca, Données Québec, Toronto, Edmonton, 131 Hub sites |
| Platform API, in review | 5 | AMO and Tribunals Ontario inside data.ontario.ca |
| Esri map server | 4 | Banff, Surrey, North Vancouver, Capital Regional District |
| Bespoke API | 2 | Statistics Canada WDS, Red Deer |
| Static page of data files | 4 | Saanich, London Transit, OEB, Sault Ste. Marie |
| Client-side app, needs a browser | 11 | CIHI, geo.ca, FRDR, Bank of Canada, NL Open Data |
| Mostly documents | 5 | Nanaimo, NL Statistics, MPHEC, Metrolinx, Birds Canada |
| No data found, or unreachable | 5 | Brandon, GeoNB, Nunavut, PEI GIS, OCUL |

These patterns came up repeatedly:

- **The directory link is often a front end, not the portal.** City "open data" pages link out to a Hub site or a provincial CKAN. Toronto's catalogue and the federal search page are front ends to CKAN APIs on other hosts.
- **Esri servers mix open and internal layers.** Banff publishes an open-data folder next to pothole, graffiti and fire-department services on the same public endpoint. The Capital Regional District has 202 services and no folder marked as open data.
- **Bespoke portals can be excellent.** Red Deer's custom portal has a paged JSON API for every dataset, but no fingerprint can find it. It turned up only by reading a dataset page.

## Barriers for agents

| Barrier | Orgs | Detail |
|---|---:|---|
| Dead link | 12 | Mostly deleted or renamed ArcGIS Hub sites (Brantford, Hastings County, Okotoks, Orangeville…), plus a Marine Data BC timeout |
| Bot challenge on web pages | 20 | AWS WAF on Données Québec and Figshare; APIs unaffected |
| TLS error | 1 | Canadian Space Agency serves an incomplete certificate chain; strict HTTP clients fail |
| Broken catalog API | 2 | Quinte West's Hub search answers "Site catalog is not configured correctly"; open.hamilton.ca returns 403 on API paths |
| Missing or wrong URL | 2 | Calgary has no URL; Shawinigan's points at Rouyn-Noranda |

251 of the 252 probed URLs use HTTPS. The median first response takes 387 ms.

## robots.txt and AI crawlers

- 18 hosts have no robots.txt.
- 4 disallow all crawlers: Borealis, Abacus and U of T Dataverse (the Dataverse default), plus PEI GIS. Their APIs answer anyway.
- 7 block named AI crawlers. Six are the Niagara group (Niagara Open Data, St. Catharines, Fort Erie, Lincoln, Niagara-on-the-Lake, Brock University), all blocking GPTBot, CCBot, Bytespider and Amazonbot. Birds Canada blocks Amazonbot.
- None names ClaudeBot or uses Content-Signal.

Whether a robots.txt `Disallow` should apply to a documented public API is an open project decision.

## Directory data quality

- 13 platform labels are wrong. For example, Guelph and Thunder Bay are labelled CKAN but run ArcGIS Hub. PEI, PEI Water Registry and Strathcona are labelled Socrata but run Hub. Kingston is labelled Opendatasoft but runs Hub. Yukon is labelled DKAN but runs CKAN.
- 45 orgs publish inside another portal (Données Québec ×20, Columbia Basin Water Hub ×12, Niagara ×5, others). Summing their counts double-counts datasets.
- Counts are stale. Regina's link no longer resolves; the city moved to openregina.ca, which has 1,379 datasets and is listed as NA. Niagara Open Data lists 3 and holds 534.

## Recommendations

**For the directory**
1. Fix the 2 broken URLs, the 12 dead links and the 13 wrong labels. The list is in the [digest](digest-2026-10-04.md#open-items).
2. Replace self-reported dataset counts with counts pulled from each portal's API.
3. Record "publishes inside portal X" as a structured field, with the portal's publisher filter.
4. Link to the portal or its API, not to a city web page about open data.

**For publishers**
1. Keep the catalog API outside any bot wall, as Données Québec does.
2. Mark which ArcGIS Server folders are open data, and keep internal services off public endpoints.
3. Fix certificate chains and broken Hub search configurations.

**For agent builders**
1. Use catalog APIs, not web pages. Six connectors (CKAN, ArcGIS Hub, Socrata, Opendatasoft, Dataverse, DCAT) cover most of the directory.
2. Treat the directory URL as a starting point. Follow links to the real portal.

## Open questions

- Are CanWIN's 48,773 records datasets, or harvested and derived records?
- How much of open.alberta.ca's 37,496 is publications rather than data?
- 11 sources need a human decision, mostly document collections and pages with no data. They are listed in the [digest](digest-2026-10-04.md#open-items).

## Method

`pnpm sync` extracted the directory. `pnpm probe` checked every org URL, one request per host at a time, 500 ms apart, with an identifying user agent. It recorded status, redirects, TLS errors, bot-protection signatures and robots.txt, then queried known catalog APIs (CKAN, ArcGIS Hub and Server, Socrata, Opendatasoft, Dataverse, GeoNetwork, DCAT). `pnpm autoprofile` followed links from pages with no recognized API and classified them. A sample was profiled by hand. Full method: [docs/HOW-IT-WORKS.md](../docs/HOW-IT-WORKS.md). To regenerate the numbers, run `pnpm db:pull && pnpm digest`.
