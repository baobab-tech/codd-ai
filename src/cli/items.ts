/**
 * Work queue.
 *
 *   pnpm items                       counts of open items by kind
 *   pnpm items needs_human           open items of one kind
 *   pnpm items resolve <id> "why"    close an item (status resolved)
 *   pnpm items wontfix <id> "why"    close an item (status wontfix)
 */
import { all, db } from "../db.js";

const [cmd, id, ...rest] = process.argv.slice(2);
const conn = await db();

if (cmd === "resolve" || cmd === "wontfix") {
  if (!id || !rest.length) throw new Error(`usage: pnpm items ${cmd} <id> "resolution"`);
  const n = await all(conn, "update open_items set status = $s, resolution = $r, updated_at = now() where id = $id returning id", { s: cmd === "resolve" ? "resolved" : "wontfix", r: rest.join(" "), id });
  console.log(n.length ? `${cmd}: ${id}` : `no item ${id}`);
} else if (cmd) {
  console.table(await all(conn, "select id, title, detail from open_items where status = 'open' and kind = $k order by title", { k: cmd }));
} else {
  console.table(await all(conn, "select kind, count(*)::int as open from open_items where status = 'open' group by 1 order by 2 desc"));
}
