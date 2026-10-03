import { join } from "node:path";
import { ROOT } from "../db.js";

export const exportPath = (t: string) => join(ROOT, t === "probes" ? "data/probes/probes.jsonl" : `registry/${t}.jsonl`);
