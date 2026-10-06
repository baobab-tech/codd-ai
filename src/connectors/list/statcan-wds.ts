/**
 * Statistics Canada Web Data Service listing (Part 1: registry). Two calls: getAllCubesListLite (every table)
 * and getCodeSets (subject, survey and frequency names). Each table gets its full-table CSV download and the
 * WDS API for point queries by vector or coordinate (Part 2 does the querying).
 */
import { UA } from "../../http.js";
import type { HarvestRecord } from "./ckan.js";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
  return res.json();
}

const LICENCE = "Statistics Canada Open Licence";
const LICENCE_URL = "https://www.statcan.gc.ca/en/reference/licence";

export async function* listStatcanWds(sourceId: string, base: string, opts: { onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  const codes = (await getJson(`${base}/getCodeSets`)).object ?? {};
  const subject = new Map<string, string>((codes.subject ?? []).map((s: any) => [String(s.subjectCode), s.subjectEn]));
  const survey = new Map<string, string>((codes.survey ?? []).map((s: any) => [String(s.surveyCode), s.surveyEn]));
  const freq = new Map<number, string>((codes.frequency ?? []).map((f: any) => [f.frequencyCode, f.frequencyDescEn]));
  const cubes: any[] = await getJson(`${base}/getAllCubesListLite`);
  opts.onPage?.(0, cubes.length);
  const out: HarvestRecord[] = cubes.map((c) => {
    const pid = String(c.productId);
    const id = `${sourceId}|${pid}`;
    const res = (suffix: string, name: string, url: string, format: string, tier: string) =>
      ({ id: `${id}|${suffix}`, dataset_id: id, source_id: sourceId, name, url, format, mimetype: null, size: null, datastore: false, tier, modified: c.releaseTime ?? null });
    const resources = [
      res("csv", "Full table CSV (zipped)", `https://www150.statcan.gc.ca/n1/tbl/csv/${pid}-eng.zip`, "CSV", "tabular_file"),
      res("wds", "WDS API (getCubeMetadata, then data by vector or coordinate)", `${base}/getCubeMetadata`, "API", "live_query"),
    ];
    const subjects = (c.subjectCode ?? []).map((s: string) => subject.get(String(s)) ?? subject.get(String(s).slice(0, 2))).filter(Boolean);
    const surveys = (c.surveyCode ?? []).map((s: string) => survey.get(String(s))).filter(Boolean);
    const span = [c.cubeStartDate?.slice(0, 10), c.cubeEndDate?.slice(0, 10)].filter(Boolean).join(" to ");
    return {
      dataset: {
        id, source_id: sourceId, native_id: pid, name: pid, title: c.cubeTitleEn ?? null,
        description: [`Statistics Canada table ${pid.slice(0, 2)}-${pid.slice(2, 4)}-${pid.slice(4, 8)}-01.`, span && `Reference period ${span}.`, surveys.length && `Source: ${surveys.join("; ")}.`].filter(Boolean).join(" "),
        publisher: "statistics-canada", publisher_title: "Statistics Canada", type: "table",
        tags: [], licence: LICENCE, landing_url: `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${pid}01`,
        created: c.issueDate ?? null, modified: c.releaseTime ?? null, harvested_at: now,
        themes: [...new Set(subjects)], keywords: surveys, frequency: freq.get(c.frequencyCode) ?? null,
        has_spatial: true, bilingual: !!(c.cubeTitleEn && c.cubeTitleFr), is_open: true, licence_url: LICENCE_URL, has_contact: true,
        resource_count: resources.length, formats: ["CSV", "API"], best_tier: "live_query",
        access_level: c.archived === "1" ? "archived" : null,
        extras: { title_fr: c.cubeTitleFr ?? null, cansim_id: c.cansimId ?? null, start: c.cubeStartDate ?? null, end: c.cubeEndDate ?? null, data_updated_at: c.releaseTime ?? null, archived: c.archived === "1" },
      },
      resources,
      raw: c,
    };
  });
  for (let i = 0; i < out.length; i += 1000) yield out.slice(i, i + 1000);
}
