/**
 * OAI-PMH listing (Part 1: registry): ListRecords in Dublin Core (oai_dc), following resumption tokens.
 * Generic for research repositories (FRDR). dc:identifier URLs become resources; dc:rights is the licence.
 */
import * as cheerio from "cheerio";
import { UA } from "../../http.js";
import { normalizeFormat, tierOf } from "../../harvest/tier.js";
import type { HarvestRecord } from "./ckan.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getXml(url: string, tries = 4): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/xml,application/xml" }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.text();
    } catch (e) {
      if (i >= tries || String(e).includes("not retried")) throw e;
      await sleep(5_000 * i * i);
    }
  }
}

export async function* listOaiPmh(sourceId: string, base: string, opts: { gapMs?: number; onPage?: (start: number, total: number) => void } = {}) {
  const now = new Date().toISOString();
  let url: string | null = `${base}?verb=ListRecords&metadataPrefix=oai_dc`;
  let seen = 0;
  while (url) {
    const $ = cheerio.load(await getXml(url), { xmlMode: true });
    const token = $("resumptionToken").first();
    opts.onPage?.(seen, Number(token.attr("completeListSize") ?? NaN));
    const recs: HarvestRecord[] = [];
    $("record").each((_, el) => {
      const r = $(el);
      if (r.find("header").attr("status") === "deleted") return;
      const all = (tag: string) => r.find(`dc\\:${tag}`).map((_, e) => $(e).text().trim()).get().filter(Boolean);
      const ident = r.find("header > identifier").text().trim();
      const id = `${sourceId}|${ident}`;
      const urls = all("identifier").filter((u) => /^https?:\/\//.test(u));
      const resources = urls.map((u, i) => {
        const format = normalizeFormat(null, u);
        const fmt = /doi\.org|handle\.net|\/dataset|\/record/.test(u) ? "HTML" : format;
        return { id: `${id}|${i}`, dataset_id: id, source_id: sourceId, name: null, url: u, format: fmt, mimetype: null, size: null, datastore: false, tier: tierOf(fmt, { url: u }), modified: null };
      });
      recs.push({
        dataset: {
          id, source_id: sourceId, native_id: ident, name: ident, title: all("title")[0] ?? null, description: all("description").join("\n").slice(0, 20_000) || null,
          publisher: all("publisher")[0] ?? null, publisher_title: all("publisher")[0] ?? null, type: all("type")[0] ?? null, tags: all("subject"),
          licence: all("rights")[0]?.slice(0, 500) ?? null, landing_url: urls[0] ?? null, created: all("date")[0] ?? null,
          modified: r.find("header > datestamp").text().trim() || null, harvested_at: now, themes: [], keywords: [], frequency: null,
          has_spatial: all("coverage").length > 0, bilingual: null, is_open: null, licence_url: null, has_contact: null,
          resource_count: resources.length, formats: [...new Set(resources.map((x) => x.format).filter(Boolean))],
          best_tier: resources.length ? resources[0].tier : null, access_level: null,
          extras: { creators: all("creator").slice(0, 20), sets: r.find("header > setSpec").map((_, e) => $(e).text()).get(), languages: all("language") },
        },
        resources,
        raw: $.xml(el),
      });
    });
    yield recs;
    seen += recs.length;
    const t = token.text().trim();
    url = t ? `${base}?verb=ListRecords&resumptionToken=${encodeURIComponent(t)}` : null;
    if (url) await sleep(opts.gapMs ?? 1_000);
  }
}
