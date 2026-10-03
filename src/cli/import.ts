/** Rebuild the DuckDB working database from the committed JSONL exports. */
import { existsSync, statSync } from "node:fs";
import { TABLES, db } from "../db.js";
import { exportPath } from "./export-path.js";

const conn = await db();
for (const t of TABLES) {
  const f = exportPath(t);
  if (!existsSync(f) || statSync(f).size === 0) continue;
  await conn.run(`delete from ${t}`);
  await conn.run(`copy ${t} from '${f}' (format json)`);
}
console.log("imported");
