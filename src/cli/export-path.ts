import { join } from "node:path";
import { ROOT } from "../db.js";

// Small, human-reviewable tables only. Probes and (later) datasets stay in the DB.
export const EXPORT_TABLES = ["orgs", "sources", "org_sources", "connectors", "open_items", "observations"];
export const exportPath = (t: string) => join(ROOT, `registry/${t}.jsonl`);
