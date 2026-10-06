/**
 * Harvest catalogs into per-source NDJSON shards (Part 1: registry).
 * Writes data/harvest/<source>/datasets.jsonl.gz and resources.jsonl.gz, plus manifest.json.
 * Does not hold the DB open while fetching; load with `pnpm harvest:load`.
 *
 *   pnpm harvest [--platform ckan] [--only source_id,...] [--parallel 4]
 */
import { createWriteStream, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import pLimit from "p-limit";
import { ROOT, all, closeDb, db } from "../db.js";
import { listCkan, type HarvestRecord } from "../connectors/list/ckan.js";
import { listArcgisHub } from "../connectors/list/arcgis-hub.js";
import { listSocrata } from "../connectors/list/socrata.js";
import { listDataverse } from "../connectors/list/dataverse.js";
import { listOpendatasoft } from "../connectors/list/opendatasoft.js";
import { listGeonetwork } from "../connectors/list/geonetwork.js";
import { listArcgisServer } from "../connectors/list/arcgis-server.js";
import { listStatcanWds } from "../connectors/list/statcan-wds.js";
import { listWebListing } from "../connectors/list/web-listing.js";
import { listGeocore } from "../connectors/list/geocore.js";
import { listOaiPmh } from "../connectors/list/oai-pmh.js";
import { listBrandon, listConp, listNatureCounts, listRedDeer, listValet } from "../connectors/list/known-apis.js";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const PLATFORM = arg("--platform") ?? "ckan";
const ONLY = arg("--only")?.split(",");
const PARALLEL = Number(arg("--parallel") ?? 4);

export const shardDir = (sourceId: string) => join(ROOT, "data/harvest", sourceId.replace(/[^a-zA-Z0-9._-]+/g, "_"));

type Lister = (id: string, base: string, opts: { gapMs?: number; recipe?: any; onPage?: (start: number, total: number) => void }) => AsyncGenerator<HarvestRecord[]>;
const LISTERS: Record<string, Lister> = { ckan: listCkan, arcgis_hub: listArcgisHub, socrata: listSocrata, dataverse: listDataverse, opendatasoft: listOpendatasoft, geonetwork: listGeonetwork, arcgis_server: listArcgisServer,
  statcan_wds: listStatcanWds, boc_valet: listValet, geocore: listGeocore, oai_pmh: listOaiPmh,
  // platform 'custom': one lister per connector_id
  web_listing: listWebListing,
  reddeer_api: listRedDeer, brandon_api: listBrandon, naturecounts: listNatureCounts, conp: listConp,
} as Record<string, Lister>;

const conn = await db();
let sources = await all<{ id: string; base_url: string; platform: string; connector_id: string | null; dataset_count: number | null; recipe: any }>(conn,
  `select id, base_url, platform, connector_id, dataset_count, recipe from sources where (platform = $p or ($p = 'web_listing' and archetype = 'web_listing')) and parent_id is null and status in ('identified', 'harvestable', 'harvested') order by dataset_count desc nulls last`, { p: PLATFORM });
await closeDb(conn);
if (ONLY) sources = sources.filter((s) => ONLY.includes(s.id));
const listerFor = (s: { platform: string; connector_id: string | null }) => (PLATFORM === "web_listing" ? LISTERS.web_listing : LISTERS[s.platform] ?? LISTERS[s.connector_id ?? ""]);
for (const s of sources) if (!listerFor(s)) throw new Error(`no lister for ${s.id} (${s.platform}/${s.connector_id})`);

function gzWriter(path: string) {
  const gz = createGzip();
  const out = createWriteStream(path);
  gz.pipe(out);
  return {
    write: (o: unknown) => gz.write(JSON.stringify(o) + "\n"),
    close: () => new Promise<void>((res) => { out.on("finish", res); gz.end(); }),
  };
}

const t0 = Date.now();
const limit = pLimit(PARALLEL);
await Promise.all(
  sources.map((s) =>
    limit(async () => {
      const dir = shardDir(s.id);
      mkdirSync(dir, { recursive: true });
      const dw = gzWriter(join(dir, "datasets.jsonl.gz.partial"));
      const rw = gzWriter(join(dir, "resources.jsonl.gz.partial"));
      const raw = gzWriter(join(dir, "raw.jsonl.gz.partial"));
      let nd = 0, nr = 0, lastLog = 0;
      const started = new Date().toISOString();
      try {
        for await (const page of listerFor(s)(s.id, s.base_url, {
          recipe: typeof s.recipe === "string" ? JSON.parse(s.recipe) : s.recipe,
          onPage: (start, total) => {
            if (Date.now() - lastLog > 30_000 || start === 0) {
              lastLog = Date.now();
              console.log(`${s.id}: ${start}/${total}`);
            }
          },
        })) {
          for (const rec of page) {
            dw.write(rec.dataset);
            raw.write(rec.raw);
            nd++;
            for (const r of rec.resources) (rw.write(r), nr++);
          }
        }
        await dw.close();
        await rw.close();
        await raw.close();
        renameSync(join(dir, "raw.jsonl.gz.partial"), join(dir, "raw.jsonl.gz"));
        renameSync(join(dir, "datasets.jsonl.gz.partial"), join(dir, "datasets.jsonl.gz"));
        renameSync(join(dir, "resources.jsonl.gz.partial"), join(dir, "resources.jsonl.gz"));
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({ source_id: s.id, platform: PLATFORM, base_url: s.base_url, started, finished: new Date().toISOString(), datasets: nd, resources: nr }, null, 2) + "\n");
        console.log(`DONE ${s.id}: ${nd} datasets, ${nr} resources`);
      } catch (e) {
        await dw.close();
        await rw.close();
        await raw.close();
        console.log(`FAILED ${s.id} after ${nd} datasets: ${e}`);
      }
    }),
  ),
);
console.log(`harvest finished in ${Math.round((Date.now() - t0) / 1000)}s`);
