# /// script
# requires-python = ">=3.11"
# ///
"""Pull the Canadian Open Data Directory org list and normalize it into registry/portals.jsonl.

The directory site (SvelteKit) has no API. Its org list is a CSV string embedded as a
template literal in one of the JS chunks. This script finds that chunk, extracts the CSV,
saves the raw snapshot, and rewrites the normalized portal registry.

Fields the directory owns are overwritten on each sync. Fields under `probe` and
`connector` belong to us and are carried over from the existing registry.

    uv run scripts/sync_directory.py
"""

import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

BASE = "https://directory.opendatasociety.ca"
ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = ROOT / "data/directory/directory.csv"
META = ROOT / "data/directory/snapshot.json"
REGISTRY = ROOT / "registry/portals.jsonl"
HEADER_MARK = "Name of Organization (EN)"
UA = "codd-ai/0.1 (+https://github.com/baobab-tech/codd-ai)"

# Directory "Portal Software" label -> our platform key. Unknown labels map to "unknown".
PLATFORMS = {
    "ckan": "ckan",
    "dkan": "dkan",
    "arcgis hub": "arcgis_hub",
    "tyler technologies": "socrata",
    "dataverse": "dataverse",
    "open data soft": "opendatasoft",
    "opendatasoft": "opendatasoft",
    "api access only": "api_only",
}

# Directory column prefix -> our field name.
COLUMNS = {
    "Name of Organization (EN)": "name_en",
    "Name of Organization (FR)": "name_fr",
    "Website (EN)": "url_en",
    "Website (FR)": "url_fr",
    "HQ Location (EN)": "location_en",
    "latitude": "lat",
    "longitude": "lon",
    "HQ Geographic Region (EN)": "region",
    "Alpha Code": "province",
    "ISO Code": "iso_code",
    "Organization Type (EN)": "org_type",
    "Portal Software (EN)": "portal_software",
    "Primary Language (EN)": "language",
    "Is Website Data Catalogue?": "is_catalogue",
    "Total Assets": "total_assets",
    "Number of Datasets": "dataset_count",
    "Entity Type (EN)": "entity_type",
    "Relationship (EN)": "relationship",
    "Notes (EN)": "notes_en",
    "Last Updated": "directory_updated",
}


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def find_csv() -> tuple[str, str]:
    """Walk the SvelteKit entry -> nodes -> chunks graph until a chunk holds the CSV."""
    html = get(f"{BASE}/directory")
    seen: set[str] = set()
    queue = [urljoin(f"{BASE}/directory", m) for m in re.findall(r'["\'](\.?/?_app/immutable/[^"\']+\.js)["\']', html)]
    while queue:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        js = get(url)
        # The CSV is the template literal that starts with the header row.
        i = js.find("`" + HEADER_MARK)
        if i != -1:
            end = js.find("`", i + 1)
            return url, js[i + 1 : end]
        queue += [urljoin(url, m) for m in re.findall(r'["\'](\.{1,2}/[^"\']+\.js)["\']', js)]
    sys.exit(f"CSV not found after scanning {len(seen)} JS files; the site build changed.")


def unescape_template(s: str) -> str:
    s = s.replace("\\`", "`").replace("\\${", "${")
    return s.replace("\\r", "\r").replace("\\n", "\n").replace("\\\\", "\\")


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def num(v: str) -> int | None:
    v = v.strip().replace(",", "")
    return int(v) if v.isdigit() else None


def normalize(row: dict[str, str]) -> dict:
    rec: dict = {}
    for col, val in row.items():
        for prefix, field in COLUMNS.items():
            if col.startswith(prefix):
                rec[field] = val.strip()
    software = rec.get("portal_software", "")
    # Quebec orgs often list only a French URL.
    url = rec.get("url_en") or rec.get("url_fr") or ""
    return {
        "id": slugify(rec["name_en"]),
        "name_en": rec["name_en"],
        "name_fr": rec.get("name_fr") or None,
        "url": url or None,
        "url_fr": rec.get("url_fr") or None,
        "host": urlparse(url).netloc.lower() or None,
        "platform": PLATFORMS.get(software.lower(), "unknown"),
        "portal_software": software or None,
        "org_type": rec.get("org_type") or None,
        "region": rec.get("region") or None,
        "province": rec.get("province") or None,
        "location": rec.get("location_en") or None,
        "lat": float(rec["lat"]) if rec.get("lat") else None,
        "lon": float(rec["lon"]) if rec.get("lon") else None,
        "language": rec.get("language") or None,
        "is_catalogue": rec.get("is_catalogue") == "1",
        "entity_type": rec.get("entity_type") or None,
        "relationship": rec.get("relationship") or None,
        "dataset_count": num(rec.get("dataset_count", "")),
        "total_assets": num(rec.get("total_assets", "")),
        "notes": rec.get("notes_en") or None,
        "directory_updated": rec.get("directory_updated") or None,
    }


def main() -> None:
    chunk_url, raw = find_csv()
    raw = unescape_template(raw)
    rows = list(csv.DictReader(io.StringIO(raw, newline="")))

    RAW_CSV.parent.mkdir(parents=True, exist_ok=True)
    RAW_CSV.write_text(raw, encoding="utf-8")

    existing: dict[str, dict] = {}
    if REGISTRY.exists():
        for line in REGISTRY.read_text().splitlines():
            r = json.loads(line)
            existing[r["id"]] = r

    out: list[dict] = []
    ids: set[str] = set()
    for row in rows:
        rec = normalize(row)
        base, n = rec["id"], 2
        while rec["id"] in ids:
            rec["id"] = f"{base}-{n}"
            n += 1
        ids.add(rec["id"])
        prev = existing.get(rec["id"], {})
        rec["probe"] = prev.get("probe")
        rec["connector"] = prev.get("connector")
        out.append(rec)

    out.sort(key=lambda r: r["id"])
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")

    added = ids - existing.keys()
    removed = existing.keys() - ids
    META.write_text(
        json.dumps(
            {
                "source": f"{BASE}/directory",
                "chunk": chunk_url,
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "organizations": len(out),
                "dataset_count_sum": sum(r["dataset_count"] or 0 for r in out),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"{len(out)} orgs from {chunk_url}")
    if existing:
        print(f"added: {sorted(added) or '-'}\nremoved: {sorted(removed) or '-'}")


if __name__ == "__main__":
    main()
