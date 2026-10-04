/** Run ad-hoc SQL against the working DB:  pnpm sql "select ..." ["select ..."] */
import { all, db } from "../db.js";

const conn = await db();
for (const q of process.argv.slice(2)) console.table(await all(conn, q));
