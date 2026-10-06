# CODD AI

Registry, connectors and (later) an MCP server over the portals in the Canadian Open Data Directory. Public repo, MIT licensed, built by Baobab Tech with the Canadian Open Data Society. TypeScript (Node 22, pnpm, tsx); state lives in one DuckDB file.

## Three parts

1. **Registry** (Part 1): discovery and conversion. All current code.
2. **Serve** (Part 2): query connectors and the MCP server.
3. **Steward** (Part 3): the maintenance agent. Until it exists, a Claude session following this file does its job.

It's one package for now, but keep the boundaries in `docs/PLAN.md` ("Three parts") so the parts can be split later:
- parts share data through the DB, not imports;
- shared code stays in `src/db.ts`, `src/http.ts` and `src/fingerprint.ts`;
- Serve never writes registry tables;
- keep catalog listing (Part 1) and query-time access (Part 2) in separate modules.

## Design stance

The project is in early design. Tables, columns, record kinds, views and observation keys can change when the data shows they are wrong: fix the model rather than work around it, and document the change in `docs/PLAN.md` or `docs/AI-READINESS.md`.

Keep it simple and scalable. Prefer a rule in an existing classify step or view over a new table or pipeline stage. When a structural change is not obvious, ask the maintainer first, with a short explanation, the evidence and a recommendation.

## Start of session

```bash
pnpm install
pnpm db:pull        # latest published DB → db/codd.duckdb
```

Then:

1. Read `NEXT.md` for where work left off and what is queued.
2. Read `docs/PLAN.md` for the data model, source archetypes and statuses, and the auto-profile routing.
3. Run `pnpm items` to see the open work queue.

`REUSE.md` covers applying this harness to another directory; only `src/cli/sync-directory.ts` is specific to this one.

## Where things stand

`NEXT.md` has the full state, the ordered next steps, decisions and gotchas. In short:

- Done: directory sync, probe, auto-profile with review routing, review tooling; CKAN harvest (101,484 unique records) and ArcGIS Hub harvest (25,341 unique items) into `datasets` / `resources`, with readiness views and licence / record-kind classification.
- Next: refresh the landscape report; write the `needs_human` brief with links; harvest the remaining platforms (validate each lister on a few sources first); theme normalization. Serve (MCP) comes after.
- Deduplication: a source that republishes another portal sets `sources.recipe.mirrors`; ArcGIS items shown on several Hub sites are deduped by item id. Both set `datasets.duplicate_of`, and the views skip duplicates.
- Keep `NEXT.md` current: update it at the end of every session with what changed and what is next.

## State lives in the DB, not in git

`db/codd.duckdb` is gitignored. It is published as GitHub release assets: `pnpm db:publish -m "what changed"` updates the rolling `db-latest` release and adds a dated snapshot. One writer at a time: pull before working, publish when done. Query it with `pnpm sql "select ..."`.

Tables, by purpose (schema in `src/db.ts`):

- `orgs`: the directory as published. Never edit it. Put corrections in `org_overrides` (with a `note` saying why).
- `sources`: how to connect: `platform`, `base_url`, `scope`, `connector_id`, `archetype`, `recipe`, `status`, `curated`. Curated sources come from profiling and are never touched by the probe.
- `org_sources`: which orgs a source serves.
- `observations`: structured facts refreshed by the probe and auto-profile (access, robots, landing, api, autoprofile).
- `open_items`: the work queue. Close items with `status='resolved'` or `'wontfix'` and a `resolution`.
- `findings`: narrative discoveries for the landscape report. Append-only.
- `datasets` / `resources`: harvested catalog records (Part 1). `record_kind` (data, document, app, image or inventory), `licence_class`, `best_tier`, `duplicate_of`, `extras`. Raw platform records sit in local shards `data/harvest/<source>/raw.jsonl.gz` (not published).

## Record what you learn

The project's purpose includes reporting on the **AI readiness** of Canadian open data. `docs/AI-READINESS.md` defines the dimensions and where each is captured. When you discover something, put it where that file says: structured facts in tables or observations, narrative in `findings`. Later reports, including visuals and grouped breakdowns, are generated from these without re-crawling. Keep raw platform records when harvesting.

Anything discovered in a session that a landscape report should mention goes into `findings`, before the session ends. This covers: how a portal really works, a blocker, a data-quality problem, a count that surprised us, an access pattern, a decision the maintainers made. One fact per finding, written so it can be quoted.

```bash
pnpm note --topic <topic> --subject <type:id> --evidence <url|query> "One fact."
pnpm note --list [--topic robots]
```

Topics: platforms, counts, reachability, bot_blocking, robots, data_quality, access_patterns, formats, licensing, connectors, decisions, other. Subject types: org, source, connector, platform, project.

Also: corrections → `org_overrides`; anything unresolved → `open_items`; how to connect → `pnpm profile-source` (writes `sources` with `archetype`, `recipe`, `curated=true`).

pnpm reserves some script names (`import`, `profile`, ...). Check with `pnpm <name>` before adding a script.

## Who decides what: the review queue

`open_items.kind` routes work:

| Kind | Who | Examples |
|---|---|---|
| `needs_review` | A Claude session can verify and close it: check the API, write the `recipe`, set `status='harvestable'` with `pnpm profile-source`, then `pnpm items resolve <id> "..."`. If it is still unclear after checking, re-open it as `needs_human` with the question. | JSON API found, file listing to confirm, JS app to inspect with the browser, org to find inside a shared portal |
| `needs_human` | A person. **Claude must not resolve these.** Present them to the user as questions, with the evidence, and record the answer (`pnpm items resolve`, plus `pnpm note --topic decisions`). | Document libraries (ingest, look elsewhere, or skip?), pages with no data found, which ArcGIS Server folders are open data, unreachable sites |
| `decision` | A person: a project-level policy question. | Whether robots.txt applies to public APIs |
| `blocker`, `dead_link`, `data_error`, `platform_mismatch` | Probe-generated facts. A session may fix them (overrides, profiling) and resolve them. | |

Rule of thumb: anything that is not clearly a data catalog, an API or a list of data files goes to a person. That includes documents, an ambiguous scope (which folders or org filter), and anything with licensing or "should this be public" implications.

`pnpm items [kind]` lists open items. `pnpm items resolve|wontfix <id> "why"` closes one.

## End of session

1. Record findings (`pnpm note`) and close the items you resolved.
2. Update `NEXT.md`.
3. Commit and push the code and docs, then `pnpm db:publish -m "..."`.

## Writing the landscape report

The published report is `reports/LANDSCAPE.md`, linked from the top of the README. To refresh it:

1. Run `pnpm digest --out reports/digest-$(date +%F).md`. Keep older digests; they are the dated evidence.
2. Rewrite `reports/LANDSCAPE.md` from the new digest: update the "As of" date and point its digest links at the new file. Keep the structure: summary, platforms, who is ready, access patterns, barriers, robots.txt, directory data quality, recommendations, open questions, method.
3. Use only numbers that appear in the digest. Findings carry the numbers from the day they were written; prefer the digest's aggregates when they differ.
4. Update the "Landscape report" table and the `identified_sources` badge in `README.md` to match.

Follow the writing style in the user's global CLAUDE.md.

## Docs layout

- `README.md`: short landing page (problem, report headline, diagram, getting started).
- `docs/HOW-IT-WORKS.md`: pipeline steps, landscape tables, database, commands, crawling etiquette.
- `docs/PLAN.md`: data model, statuses, routing, connectors, open questions.
- `docs/AI-READINESS.md`: readiness dimensions, where each is captured, groupings, report types.
- `REUSE.md`: fork guide. `NEXT.md`: working log and queue.

## Commands

| Command | Does |
|---|---|
| `pnpm sync` | Re-pull the directory into `orgs` |
| `pnpm probe [--only id,id]` | Fingerprint org URLs → `sources`, `observations`, `open_items`, `probes` |
| `pnpm note` | Record or list findings |
| `pnpm autoprofile [--only ...] [--dry-run]` | Profile `needs_profiling` sources and route each to applied / needs_review / needs_human |
| `pnpm items [kind]` / `pnpm items resolve <id> "why"` | Work queue |
| `pnpm profile-source <org> --id --archetype --base-url [--recipe --scope --parent --replaces ...]` | Record a profiled source (curated; the probe won't overwrite it), close its profiling items, supersede an earlier source |
| `pnpm digest` | Report input digest |
| `pnpm harvest [--platform ckan] [--only ...]` / `pnpm harvest:load` | Fetch catalogs into `data/harvest/` shards (raw + mapped); load into `datasets` / `resources` |
| `pnpm sql "..."` | Ad-hoc SQL |
| `pnpm db:pull` / `db:publish` | Fetch / publish the DB |
| `pnpm db:export` / `db:import` | Optional JSONL round-trip of the small tables for a readable diff |

## Etiquette when probing

Requests to a host go one at a time, 500 ms apart, with a `codd-ai` user agent. A browser user agent is used only to test whether a block depends on the user agent, and the result is recorded. Ask the maintainer before any new bulk crawl.
