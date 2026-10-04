# Landscape notes

Running notes toward the landscape analysis of the directory's portals and how agent-friendly they are. Source: `pnpm probe`, first full run 2026-10-04 (1,274 requests). Query live numbers with `pnpm sql`.

## Platforms (detected via API, not directory labels)

| Platform | Orgs | Live datasets (top-level sources) |
|---|---:|---:|
| ArcGIS Hub | 132 | 13,180 |
| CKAN | 46 | ~199k across 37 sources (includes scoped duplicates) |
| Socrata | 9 | 3,183 |
| Dataverse | 3 | 28,649 |
| DCAT `data.json` only | 4 | 423 |
| Opendatasoft | 2 | 226 |
| Figshare | 1 | not counted yet |
| No API found (needs profiling) | 42 | – |
| Dead / no URL | 14 | – |

196 of 253 orgs (77%) have a machine-readable catalog API that one of six connectors can harvest.

Top-level portals with a live API report 190k datasets, against 104,617 in the directory. Largest gaps:

| Source | Live | Directory |
|---|---:|---:|
| CanWIN (U Manitoba) CKAN | 48,773 | 496 |
| open.canada.ca CKAN | 47,964 | 34,844 |
| open.alberta.ca CKAN | 37,496 | NA |
| Borealis Dataverse | 24,632 | 21,755 |
| open.yukon.ca CKAN | 3,861 | NA |
| BC Data Catalogue CKAN | 3,363 | NA |

Alberta's count includes publications (mostly PDFs). CanWIN's count likely includes harvested or derived records; check before treating as datasets.

## Directory label accuracy

12 orgs carry a wrong platform label. Examples: Guelph and Thunder Bay are labelled CKAN but run ArcGIS Hub; PEI and Strathcona are labelled Socrata but run Hub; Kingston is labelled Opendatasoft but runs Hub. Yukon is labelled DKAN but runs CKAN. Several "Other"/NA orgs are standard platforms: Alberta, Ontario, Yukon and Toronto are CKAN, and Borealis is Dataverse.

## Reachability

- 12 dead links: 9 return 404 (mostly ArcGIS Hub sites deleted or renamed), 1 DNS failure (open.regina.ca), and 2 non-Hub city pages moved.
- 1 TLS failure: Canadian Space Agency (`donnees-data.asc-csa.gc.ca`) serves an incomplete certificate chain. Strict clients (Node, Python) fail; browsers recover via AIA.
- AWS WAF bot control on donneesquebec.ca: HTML pages answer 202 challenge pages under repeated requests and stay challenged even with a browser UA. The CKAN API on the same host is unaffected. This covers the 20 Quebec orgs.
- open.hamilton.ca returns 403 on API paths. Its data comes from a McMaster-hosted Hub.
- ArcGIS Hub sites can have a broken search API: Quinte West returns "Site catalog is not configured correctly".
- 251 of 252 reachable landing pages are HTTPS. Median first-response time is 387 ms.

## robots.txt and AI crawlers

- 19 hosts have no robots.txt.
- 4 disallow everything for `*`: Borealis, Abacus and U of T (all Dataverse defaults), plus PEI GIS. Their APIs answer normally.
- 7 name AI crawlers and block them. Six are the Niagara region group (Niagara Open Data, St. Catharines, Fort Erie, Lincoln, Niagara-on-the-Lake, Brock University), which block GPTBot, CCBot, Bytespider and Amazonbot. Birds Canada blocks Amazonbot.
- No host names ClaudeBot or the other Anthropic agents. No host uses Content-Signal.

## Not yet profiled

These 42 orgs have no known catalog API. They range from proper APIs not yet fingerprinted (Bank of Canada Valet, StatCan WDS, GeoNetwork at Marine Data BC, FRDR, geo.ca) to HTML pages listing files (Saanich, Tribunals Ontario, London Transit, OEB, Elections Canada) and portals behind client-side apps (Red Deer, Windsor, NL). Full list: `pnpm sql "select * from open_items where kind='needs_profiling' and status='open'"`.
