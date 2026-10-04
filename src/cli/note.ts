/**
 * Record a finding for the landscape report.
 *
 *   pnpm note --topic robots --subject org:borealis --evidence https://borealisdata.ca/robots.txt "Borealis disallows all crawlers; API still answers."
 *   pnpm note --list [--topic robots]
 */
import { all, db } from "../db.js";

const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const conn = await db();

if (args.includes("--list")) {
  const topic = opt("--topic");
  console.table(await all(conn, `select id, topic, subject_type || ':' || subject_id as subject, finding, author, created_at::date::varchar as date from findings ${topic ? "where topic = $topic" : ""} order by topic, id`, topic ? { topic } : undefined));
} else {
  const flags = new Set(["--topic", "--subject", "--evidence", "--author"]);
  const text = args.filter((a, i) => !flags.has(a) && !flags.has(args[i - 1])).join(" ").trim();
  const topic = opt("--topic");
  if (!topic || !text) throw new Error('usage: pnpm note --topic <topic> [--subject type:id] [--evidence url] [--author claude] "finding"');
  const [subject_type, ...rest] = (opt("--subject") ?? "project:").split(":");
  await all(conn, "insert into findings (topic, subject_type, subject_id, finding, evidence, author) values ($topic, $st, $sid, $f, $e, $a)", {
    topic, st: subject_type, sid: rest.join(":") || "", f: text, e: opt("--evidence") ?? "", a: opt("--author") ?? "claude",
  });
  console.log(`recorded [${topic}] ${text}`);
}
