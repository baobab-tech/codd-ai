/** Optional: write the small tables to registry/*.jsonl when you want a readable diff in git. The DB is the source of truth. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, db } from "../db.js";
import { EXPORT_TABLES, exportPath } from "./export-path.js";

const conn = await db();
mkdirSync(join(ROOT, "registry"), { recursive: true });
for (const t of EXPORT_TABLES) await conn.run(`copy (select * from ${t} order by all) to '${exportPath(t)}' (format json)`);
console.log(`exported ${EXPORT_TABLES.join(", ")}`);
