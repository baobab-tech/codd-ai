/** Write every table to JSONL (sorted, stable) so working state is reviewable and versioned in git. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TABLES, db } from "../db.js";
import { exportPath } from "./export-path.js";

const conn = await db();
for (const d of ["registry", "data/probes"]) mkdirSync(join(ROOT, d), { recursive: true });
for (const t of TABLES) {
  await conn.run(`copy (select * from ${t} order by all) to '${exportPath(t)}' (format json)`);
}
console.log(`exported ${TABLES.join(", ")}`);
