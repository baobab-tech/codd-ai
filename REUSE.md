# Reusing CODD AI for another directory

CODD AI was built for the Canadian Open Data Directory, but only the first step is specific to it. Any "directory of data portals" fits the same pipeline: a national or regional meta-catalog, a list of publishers on data.europa.eu, a sector registry, or a spreadsheet of city portals.

## What is generic and what is not

| Part | Files | Specific to this directory? |
|---|---|---|
| Directory sync | `src/cli/sync-directory.ts` | **Yes.** It extracts a CSV from this site's JS bundle and maps its bilingual columns. |
| `orgs` columns | `src/db.ts` | Partly. `name_fr`, `url_fr`, `province`, `region` and `language` reflect this directory; other directories can leave them null. |
| Host aliases | `API_HOME` in `src/fingerprint.ts` | Yes. Two Canadian front-end → API host mappings. |
| Digest grouping | `src/cli/digest.ts` | Partly. It groups coverage by `province` and `org_type`. |
| User agent | `UA` in `src/http.ts` | Yes. It names this repository; a fork should name its own. |
| Probe, fingerprints, auto-profile | `src/cli/probe.ts`, `src/fingerprint.ts`, `src/cli/autoprofile.ts` | No |
| Sources, archetypes, recipes, review queue, findings | `src/db.ts`, `src/cli/profile.ts`, `src/cli/items.ts`, `src/cli/note.ts` | No |
| DB publish/pull via GitHub releases | `src/cli/db-publish.ts`, `src/cli/db-pull.ts` | No. They use whichever repo `gh` sees in the working directory. |
| Session conventions | `CLAUDE.md` | Mostly generic; the intro names this directory. |

The platform fingerprints cover catalog stacks used worldwide: CKAN, ArcGIS Hub, ArcGIS Server, Socrata, Opendatasoft, Dataverse, GeoNetwork, and DCAT `data.json`. Adding one is a `try*` function in `src/fingerprint.ts` plus a line in `fingerprint()`.

## Fork and run

1. **Fork the repo** and clone it. Requires Node 22+, pnpm and the GitHub CLI.
2. **Start with an empty database.** Don't `pnpm db:pull`; that fetches the Canadian data. Any command creates `db/codd.duckdb` with the schema on first run.
3. **Write a sync adapter.** Replace `src/cli/sync-directory.ts`, or add another script next to it, so it writes one row per organization into `orgs`:

   | Field | Required | Notes |
   |---|---|---|
   | `id` | yes | Stable slug; `slugify(name)` is in the current adapter |
   | `name_en` | yes | Display name in any language |
   | `url` | yes, for probing | The portal or data page |
   | `host` | | Lower-cased host of `url` |
   | `platform_label` | | The directory's own platform label, normalized (`ckan`, `arcgis_hub`, ...). Used to order fingerprints and to flag mismatches; `unknown` is fine |
   | `org_type`, `region`, `province` | | Used by digest grouping |
   | `relationship` | | Text containing "publish" marks the org as publishing under another portal |
   | `dataset_count` | | Self-reported count, compared against the live count |
   | everything else | | Leave null |

   Use `upsert(conn, "orgs", rows)` from `src/db.ts`. If the directory is a CSV or spreadsheet you already have, the adapter is a few lines with `papaparse`.
4. **Change the identity:** `UA` in `src/http.ts`, `name`/`repository` in `package.json`, and the intro of `README.md` and `CLAUDE.md`.
5. **Clear Canada-specific aliases:** empty `API_HOME` in `src/fingerprint.ts`, then add your own when you find portals whose API lives on a different host from the site.
6. **Run the pipeline:**

   ```bash
   pnpm sync                    # your adapter
   pnpm probe                   # ~5 requests per org, one per host at a time
   pnpm autoprofile             # for orgs with no recognized API
   pnpm items                   # what needs review
   pnpm digest                  # landscape digest
   pnpm db:publish -m "first probe"   # publishes to your fork's releases
   ```

7. **Adjust the digest grouping** in `src/cli/digest.ts` if `province` means nothing for your directory (country, state or sector, for example).

## Several directories in one database

One database per directory (one fork, or one `CODD_DB=path` per directory) works today with no code changes. To share one database across directories:

- add a `directory_id` column to `orgs`, and to `findings` if reports should be per directory;
- add an `attrs json` column to `orgs` for directory-specific fields, instead of more columns;
- move `API_HOME` into a `host_aliases` table;
- make the digest take a `--directory` filter and grouping dimensions as parameters.

## Etiquette

The probe identifies itself, sends requests to a host one at a time 500 ms apart, records robots.txt, and uses a browser user agent only to test whether a block depends on the user agent. Keep those defaults, and tell the directory's maintainers before probing their whole list.
