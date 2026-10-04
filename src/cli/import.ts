/** Overwrite the small tables in the DB from registry/*.jsonl (e.g. after hand-editing an export). */
import { existsSync, statSync } from "node:fs";
import { db } from "../db.js";
import { EXPORT_TABLES, exportPath } from "./export-path.js";

const conn = await db();
for (const t of EXPORT_TABLES) {
  const f = exportPath(t);
  if (!existsSync(f) || statSync(f).size === 0) continue;
  await conn.run(`delete from ${t}`);
  await conn.run(`copy ${t} from '${f}' (format json)`);
}
console.log("imported");
