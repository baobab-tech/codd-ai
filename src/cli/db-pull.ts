/**
 * Download the published DB from the `db-latest` release (or a dated tag) into db/.
 * Keeps the current local DB as db/codd.duckdb.bak.
 *
 *   pnpm db:pull [tag]
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { DB_PATH, ROOT } from "../db.js";

const tag = process.argv[2] ?? "db-latest";
const dir = join(ROOT, "db");
mkdirSync(dir, { recursive: true });
execFileSync("gh", ["release", "download", tag, "-p", "codd.duckdb.gz", "-p", "manifest.json", "-D", dir, "--clobber"], { cwd: ROOT, stdio: "inherit" });

if (existsSync(DB_PATH)) copyFileSync(DB_PATH, DB_PATH + ".bak");
rmSync(DB_PATH + ".wal", { force: true });
await pipeline(createReadStream(join(dir, "codd.duckdb.gz")), createGunzip(), createWriteStream(DB_PATH));
const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
console.log(`pulled ${m.tag} (published ${m.published_at})`, m.counts);
