/**
 * Publish the working DB as a GitHub release asset.
 * Replaces the asset on the rolling `db-latest` release and keeps a dated release as a snapshot.
 *
 *   pnpm db:publish [-m "note"]
 */
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { DB_PATH, ROOT, TABLES, all, closeDb, db } from "../db.js";

export const LATEST = "db-latest";
const ASSET = join(ROOT, "db/codd.duckdb.gz");
const MANIFEST = join(ROOT, "db/manifest.json");

const gh = (...args: string[]) => execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const note = process.argv.includes("-m") ? process.argv[process.argv.indexOf("-m") + 1] : "";

const conn = await db();
const counts: Record<string, number> = {};
for (const t of TABLES) counts[t] = Number((await all<{ n: number }>(conn, `select count(*) as n from ${t}`))[0].n);
await closeDb(conn);

const now = new Date();
const tag = `db-${now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}`;
const manifest = { tag, published_at: now.toISOString(), git_sha: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(), note, counts };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
await pipeline(createReadStream(DB_PATH), createGzip({ level: 9 }), createWriteStream(ASSET));

const body = `${note ? note + "\n\n" : ""}\`\`\`json\n${JSON.stringify(counts, null, 2)}\n\`\`\``;
gh("release", "create", tag, ASSET, MANIFEST, "--title", tag, "--notes", body, "--latest=false");
try {
  gh("release", "view", LATEST);
} catch {
  gh("release", "create", LATEST, "--title", "DB (latest)", "--notes", "Rolling copy of the most recent db:publish. See dated db-* releases for history.", "--latest=false");
}
gh("release", "upload", LATEST, ASSET, MANIFEST, "--clobber");
gh("release", "edit", LATEST, "--notes", `Latest: ${tag}\n\n${body}`);
console.log(`published ${tag}`, counts);
