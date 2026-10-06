<div align="center">

<img src="assets/codd.svg" alt="CODD AI logo: a friendly red cod with white bar-chart stripes" width="260">

# CODD AI

**Canada Open Data Directory AI**

A registry, connectors and an MCP server so AI agents can find and query the open data behind the [Canadian Open Data Directory](https://directory.opendatasociety.ca/directory).

[![License: MIT](https://img.shields.io/badge/license-MIT-2C6E91.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![DuckDB](https://img.shields.io/badge/DuckDB-FFF000?logo=duckdb&logoColor=black)](src/db.ts)
[![MCP](https://img.shields.io/badge/MCP-planned-8FA35E)](docs/PLAN.md#mcp-surface-draft)
[![Status](https://img.shields.io/badge/status-early-orange)](NEXT.md)

[![Portals](https://img.shields.io/badge/portals-253-D80621)](https://directory.opendatasociety.ca/directory)
[![With a catalog API](https://img.shields.io/badge/identified_sources-210%2F253-2C6E91)](docs/PLAN.md)
[![Database](https://img.shields.io/badge/database-db--latest-6E7F45)](https://github.com/baobab-tech/codd-ai/releases/tag/db-latest)
[![Made in Canada](https://img.shields.io/badge/made_in-Canada_%F0%9F%8D%81-D80621)](https://opendatasociety.ca)

[Landscape report](reports/LANDSCAPE.md) · [How it works](docs/HOW-IT-WORKS.md) · [Design](docs/PLAN.md) · [Reuse it](REUSE.md) · [Work queue](NEXT.md)

</div>

---

Built in collaboration with the [Canadian Open Data Society](https://opendatasociety.ca). [Baobab Tech](https://baobabtech.ai), a corporate member of the Society, is providing technical leadership for this project. Code is MIT licensed.

## The problem

The directory lists 253 Canadian organizations that publish open data, which together report about 105k datasets. Each entry points to a portal, and the portals vary widely: catalog platforms with APIs (CKAN, ArcGIS Hub, Socrata…), bespoke APIs, map servers, static pages of files, PDFs, dead links and bot walls. An agent can't use "the directory" directly. For each source it needs to know how to list what is there and how to get at the data.

## Landscape report

**[Read the landscape report →](reports/LANDSCAPE.md)** What the directory holds, which platforms run it, how agent-friendly each portal is, and what gets in the way.

| | |
|---|---|
| Organizations | 253 |
| Readable by an agent today | 210 (83%) |
| Records behind live catalog APIs | 203,028 (directory reports 104,617) |
| Most common platform | ArcGIS Hub, 136 orgs |
| Dead links | 12 |

## How it works

<p align="center"><img src="assets/pipeline.svg" alt="Pipeline: directory → orgs (pnpm sync) → sources (pnpm probe) → auto-profile (applied, needs review, needs human) → curated sources → datasets (next) → MCP server (planned). org_overrides holds corrections; observations, open_items, findings and probes feed the landscape analysis." width="100%"></p>

The project has three parts:

1. **Registry** (discovery and conversion): pull the directory, probe every portal, identify its catalog API, profile the rest, and harvest dataset records. In progress.
2. **Serve**: connectors and an MCP server that let agents search the registry and query the data. Planned.
3. **Steward**: a maintenance agent that keeps the registry current. It catches new datasets and dead URLs, parses unstructured sources, and works the review queue. Planned.

Everything learned along the way is recorded for the landscape report.

Details: [How it works](docs/HOW-IT-WORKS.md) · [Design](docs/PLAN.md)

## Getting started

Requires Node 22+, pnpm, and the GitHub CLI (`gh`).

```bash
pnpm install
pnpm db:pull                 # download the latest published database
pnpm digest                  # landscape numbers
```

All commands are listed in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#commands).

## Status

Early. Directory sync, probing and auto-profiling work: 210 of 253 orgs have an identified source, 30 are in the review queue, and 13 have a dead link or no URL. Connectors, harvesting and the MCP server are next. [NEXT.md](NEXT.md) is the working log and has the current to-do list.

## Reuse

Only the directory sync is specific to this directory. [REUSE.md](REUSE.md) explains how to fork this for another meta-catalog.

## Licence

Code: [MIT](LICENSE).

`data/directory/` holds a snapshot of the Canadian Open Data Directory, maintained by the Canadian Open Data Society. Datasets reached through the connectors stay under their publishers' own licences.
