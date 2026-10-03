# CODD AI

Canada Open Data Directory AI: a registry, connectors, and an MCP server over the portals listed in the [Canadian Open Data Directory](https://directory.opendatasociety.ca/directory) (253 organizations, ~104k datasets).

## Layout

- `data/directory/` — raw CSV snapshot of the directory and fetch metadata
- `registry/portals.jsonl` — one normalized record per organization; `probe` and `connector` fields are ours and survive re-syncs
- `scripts/sync_directory.py` — re-pulls the directory from the site's JS bundle
- `docs/PLAN.md` — data model, storage, connectors, pipeline, open questions

## Sync

```bash
uv run scripts/sync_directory.py
```
