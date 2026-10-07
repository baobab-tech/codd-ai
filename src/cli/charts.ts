/**
 * Landscape report charts as static SVG, generated from the DB. Rerun after each digest.
 * Plain SVG (no dependencies): light and dark styles via prefers-color-scheme, a <title> per mark for hover.
 *
 *   pnpm charts [--out reports/charts]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, all, closeDb, db } from "../db.js";

const OUT = join(ROOT, process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "reports/charts");
const conn = await db();
const q = (sql: string) => all(conn, sql) as Promise<Record<string, any>[]>;

// Reference palette (dataviz skill): categorical slots 1–5 validated adjacent-pair in light and dark.
const LIGHT = { bg: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", base: "#c3c2b7", s: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] };
const DARK = { bg: "#1a1a19", ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", base: "#383835", s: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] };
// Concrete colours per rule (no CSS variables: several SVG renderers don't support them); dark mode overrides the same rules.
const colours = (p: typeof LIGHT) =>
  `.bg{fill:${p.bg}} .t,.l{fill:${p.ink}} .st,.v{fill:${p.ink2}} .m{fill:${p.muted}} .grid{stroke:${p.grid}} .base{stroke:${p.base}} ` +
  p.s.map((c, i) => `.s${i + 1}{fill:${c}}`).join(" ");
const FONT = `system-ui,-apple-system,"Segoe UI",sans-serif`;
const STYLE = `<style>
.t{font:600 16px ${FONT}} .st,.v{font:12px ${FONT}} .l{font:13px ${FONT}} .m{font:11px ${FONT}} .in{font:600 11px ${FONT}}
.v{font-variant-numeric:tabular-nums} .grid,.base{stroke-width:1}
${colours(LIGHT)}
.i1,.i2{fill:#ffffff} .i3,.i4,.i5{fill:#0b0b0b}
@media (prefers-color-scheme: dark){${colours(DARK)} .i3,.i5{fill:#ffffff}}
</style>`;

const W = 760;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) => n.toLocaleString("en-CA");
const pct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const textW = (s: string, px = 11) => s.length * px * 0.56; // rough width for fit checks

// Bar with a 4px rounded data end (right), square at the baseline (left).
function bar(x: number, y: number, w: number, h: number, cls: string, tip: string, round = true) {
  const r = round ? Math.min(4, w / 2, h / 2) : 0;
  const d = r
    ? `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`
    : `M${x},${y}h${w}v${h}h${-w}z`;
  return `<path class="${cls}" d="${d}"><title>${esc(tip)}</title></path>`;
}

function frame(title: string, subtitle: string, height: number, body: string, desc: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-labelledby="t d">
${STYLE}
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect class="bg" width="${W}" height="${height}" rx="8"/>
<text class="t" x="20" y="30">${esc(title)}</text>
<text class="st" x="20" y="50">${esc(subtitle)}</text>
${body}
</svg>\n`;
}

function legend(keys: { label: string; cls: string }[], y: number) {
  let x = 20;
  return keys
    .map((k) => {
      const s = `<rect class="${k.cls}" x="${x}" y="${y - 9}" width="10" height="10" rx="2"/><text class="v" x="${x + 15}" y="${y}">${esc(k.label)}</text>`;
      x += 15 + textW(k.label, 12) + 18;
      return s;
    })
    .join("");
}

/** Single-series horizontal bars. */
function hbars(o: { title: string; subtitle: string; rows: { label: string; value: number; display: string }[]; max?: number; labelW?: number; ticks?: number[]; tickFmt?: (n: number) => string }) {
  const lw = o.labelW ?? 220, x0 = 20 + lw, plotW = W - x0 - 110, top = 72, band = 26, bh = 16;
  const max = o.max ?? Math.max(...o.rows.map((r) => r.value));
  const sx = (v: number) => (v / max) * plotW;
  const h = top + o.rows.length * band + 30;
  const ticks = (o.ticks ?? []).map((t) => `<line class="grid" x1="${x0 + sx(t)}" x2="${x0 + sx(t)}" y1="${top - 6}" y2="${h - 26}"/><text class="m" x="${x0 + sx(t)}" y="${h - 12}" text-anchor="middle">${(o.tickFmt ?? fmt)(t)}</text>`).join("");
  const rows = o.rows
    .map((r, i) => {
      const y = top + i * band;
      return `<text class="l" x="${x0 - 10}" y="${y + bh - 3}" text-anchor="end">${esc(r.label)}</text>${r.value > 0 ? bar(x0, y, Math.max(sx(r.value), 2), bh, "s1", `${r.label}: ${r.display}`) : ""}<text class="v" x="${x0 + sx(r.value) + 6}" y="${y + bh - 3}">${esc(r.display)}</text>`;
    })
    .join("\n");
  return frame(o.title, o.subtitle, h, `${ticks}<line class="base" x1="${x0}" x2="${x0}" y1="${top - 6}" y2="${h - 26}"/>\n${rows}`, `${o.subtitle}. ${o.rows.map((r) => `${r.label}: ${r.display}`).join("; ")}.`);
}

/** 100% stacked horizontal bars, one per group. Parts in fixed key order; labels inside segments only when they fit. */
function stacked(o: { title: string; subtitle: string; keys: { key: string; label: string }[]; groups: { label: string; parts: Record<string, number> }[]; unit?: string; labelW?: number }) {
  const lw = o.labelW ?? 150, x0 = 20 + lw, plotW = W - x0 - 20, top = 96, band = 44, bh = 24, gap = 2;
  const h = top + o.groups.length * band + 10;
  const keys = o.keys.map((k, i) => ({ ...k, cls: `s${i + 1}` }));
  const body = o.groups
    .map((g, gi) => {
      const y = top + gi * band;
      const total = keys.reduce((a, k) => a + (g.parts[k.key] ?? 0), 0);
      const present = keys.filter((k) => (g.parts[k.key] ?? 0) > 0);
      const usable = plotW - gap * (present.length - 1);
      let x = x0;
      const segs = present
        .map((k, i) => {
          const v = g.parts[k.key], w = (v / total) * usable, share = v / total;
          const tip = `${g.label}, ${k.label}: ${fmt(v)} (${pct(share * 100)})`;
          const s = bar(x, y, w, bh, k.cls, tip, i === present.length - 1);
          const label = pct(share * 100);
          const inside = textW(label) + 10 < w ? `<text x="${x + w / 2}" y="${y + bh / 2 + 4}" text-anchor="middle" class="in i${k.cls.slice(1)}">${label}</text>` : "";
          x += w + gap;
          return s + inside;
        })
        .join("");
      return `<text class="l" x="${x0 - 10}" y="${y + bh / 2 + 4}" text-anchor="end">${esc(g.label)}</text><text class="m" x="${x0 - 10}" y="${y + bh / 2 + 18}" text-anchor="end">${fmt(total)} ${o.unit ?? "records"}</text>${segs}`;
    })
    .join("\n");
  const desc = o.groups.map((g) => `${g.label}: ${keys.map((k) => `${k.label} ${fmt(g.parts[k.key] ?? 0)}`).join(", ")}`).join(". ");
  return frame(o.title, o.subtitle, h, legend(keys, 76) + "\n" + body, desc);
}

/** Grouped horizontal bars: one row block per measure, one bar per series. */
function grouped(o: { title: string; subtitle: string; series: string[]; measures: { label: string; values: number[] }[] }) {
  const lw = 200, x0 = 20 + lw, plotW = W - x0 - 70, top = 96, bh = 14, gap = 2, block = o.series.length * (bh + gap) + 18;
  const h = top + o.measures.length * block + 24;
  const sx = (v: number) => (v / 100) * plotW;
  const ticks = [0, 25, 50, 75, 100].map((t) => `<line class="grid" x1="${x0 + sx(t)}" x2="${x0 + sx(t)}" y1="${top - 6}" y2="${h - 26}"/><text class="m" x="${x0 + sx(t)}" y="${h - 12}" text-anchor="middle">${t}%</text>`).join("");
  const body = o.measures
    .map((m, mi) => {
      const y0 = top + mi * block;
      const bars = m.values
        .map((v, si) => {
          const y = y0 + si * (bh + gap);
          return bar(x0, y, Math.max(sx(v), 2), bh, `s${si + 1}`, `${m.label}, ${o.series[si]}: ${pct(v)}`) + `<text class="v" x="${x0 + sx(v) + 6}" y="${y + bh - 3}">${pct(v)}</text>`;
        })
        .join("");
      return `<text class="l" x="${x0 - 10}" y="${y0 + (o.series.length * (bh + gap)) / 2 + 3}" text-anchor="end">${esc(m.label)}</text>${bars}`;
    })
    .join("\n");
  const desc = o.measures.map((m) => `${m.label}: ${m.values.map((v, i) => `${o.series[i]} ${pct(v)}`).join(", ")}`).join(". ");
  return frame(o.title, o.subtitle, h, ticks + `<line class="base" x1="${x0}" x2="${x0}" y1="${top - 6}" y2="${h - 26}"/>` + legend(o.series.map((s, i) => ({ label: s, cls: `s${i + 1}` })), 76) + "\n" + body, desc);
}

const PLATFORM: Record<string, string> = {
  arcgis_hub: "ArcGIS Hub", ckan: "CKAN", socrata: "Socrata", dcat: "DCAT data.json", arcgis_server: "ArcGIS Server", dataverse: "Dataverse",
  opendatasoft: "Opendatasoft", custom: "Custom API", unknown: "No platform (web pages)", none: "No source",
};
const PNAME: Record<string, string> = { ...PLATFORM, statcan_wds: "StatCan WDS", boc_valet: "Bank of Canada Valet", geonetwork: "GeoNetwork", geocore: "GeoCore", oai_pmh: "OAI-PMH (FRDR)", unknown: "Web pages", custom: "Bespoke APIs" };
const charts: Record<string, string> = {};
const date = new Date().toISOString().slice(0, 10);

// 1. Orgs by platform (same rule as the digest: an org's platform is its top-level source's).
{
  const rows = await q(`with op as (select o.id, coalesce(min(s.platform), 'none') as platform from orgs o
      left join org_sources os on os.org_id = o.id left join sources s on s.id = os.source_id group by 1)
    select platform, count(*)::int as n from op group by 1 order by n desc`);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const named = rows.filter((r) => PLATFORM[r.platform] && r.platform !== "unknown" && r.platform !== "none");
  const other = rows.filter((r) => !PLATFORM[r.platform]);
  const tail = rows.filter((r) => r.platform === "unknown" || r.platform === "none");
  const list = [...named, ...(other.length ? [{ platform: "other", n: other.reduce((a, r) => a + r.n, 0) }] : []), ...tail];
  charts["orgs-by-platform"] = hbars({
    title: "Organizations by catalog platform",
    subtitle: `${total} organizations in the directory, platform detected through each portal's API (as of ${date})`,
    rows: list.map((r) => ({ label: r.platform === "other" ? `Other APIs (${other.length} kinds)` : PLATFORM[r.platform], value: r.n, display: `${r.n} (${pct((r.n / total) * 100)})` })),
    labelW: 160, ticks: [0, 50, 100, 150],
  });
}

// 2. Record kinds by platform.
const KINDS = [{ key: "data", label: "Data" }, { key: "document", label: "Documents" }, { key: "image", label: "Images" }, { key: "app", label: "Apps" }, { key: "inventory", label: "Inventory (unreleased)" }];
{
  const rows = await q(`select s.platform, d.record_kind, count(*)::int as n from v_dataset_readiness d join sources s on s.id = d.source_id group by all`);
  const tot = new Map<string, number>();
  for (const r of rows) tot.set(r.platform, (tot.get(r.platform) ?? 0) + r.n);
  const top = [...tot.entries()].filter(([, n]) => n >= 500).sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const groups = top.map((p) => ({ label: PNAME[p] ?? p, parts: Object.fromEntries(rows.filter((r) => r.platform === p).map((r) => [r.record_kind, r.n])) }));
  const total = rows.reduce((a, r) => a + r.n, 0), data = rows.filter((r) => r.record_kind === "data").reduce((a, r) => a + r.n, 0);
  charts["record-kinds"] = stacked({ title: "Catalog records by kind", subtitle: `${fmt(total)} unique harvested records; ${fmt(data)} (${pct((data / total) * 100)}) are data. Platforms with 500+ records.`, keys: KINDS, groups, labelW: 170 });
}

// 3. Readiness of data records, the four platforms with the most data records.
{
  const rows = await q(`select s.platform, count(*)::int as n, avg(machine_readable)*100 as mr, avg(live_query)*100 as lq, avg(open_licence)*100 as ol, avg(described)*100 as de, avg(discoverable)*100 as di
    from v_dataset_readiness d join sources s on s.id = d.source_id where d.record_kind = 'data' group by 1 order by n desc limit 4`);
  charts["data-readiness"] = grouped({
    title: "AI readiness of data records",
    subtitle: `Share of unique data records, four largest platforms: ${rows.map((r) => `${PNAME[r.platform] ?? r.platform} ${fmt(r.n)}`).join(", ")}`,
    series: rows.map((r) => PNAME[r.platform] ?? r.platform),
    measures: [
      { label: "Machine-readable", values: rows.map((r) => r.mr) },
      { label: "Live-queryable", values: rows.map((r) => r.lq) },
      { label: "Open licence", values: rows.map((r) => r.ol) },
      { label: "Described (100+ characters)", values: rows.map((r) => r.de) },
      { label: "3+ tags or keywords", values: rows.map((r) => r.di) },
    ],
  });
}

// 3b. How each platform's data records can be reached (best resource tier).
{
  const rows = await q(`select s.platform, case when best_tier in ('link_only') or best_tier is null then 'other' else best_tier end as tier, count(*)::int as n
    from datasets d join sources s on s.id = d.source_id where d.duplicate_of is null and d.record_kind = 'data' group by all`);
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.platform, (totals.get(r.platform) ?? 0) + r.n);
  const groups = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => ({ label: PNAME[p] ?? p, parts: Object.fromEntries(rows.filter((r) => r.platform === p).map((r) => [r.tier, r.n])) }));
  charts["tiers-by-platform"] = stacked({
    title: "How data records can be reached, by platform",
    subtitle: "Best resource per unique data record",
    keys: [{ key: "live_query", label: "Live query API" }, { key: "tabular_file", label: "Tabular file" }, { key: "geo_file", label: "GIS file" }, { key: "document", label: "Document only" }, { key: "other", label: "Link or nothing" }],
    groups, labelW: 170,
  });
}

// 4. Licence classes of data records.
{
  const rows = await q(`select s.platform, d.licence_class, count(*)::int as n from v_dataset_readiness d join sources s on s.id = d.source_id
    where d.record_kind = 'data' group by all`);
  const fold = (lc: string) => (lc === "no_derivatives" ? "restricted" : lc);
  const tot = new Map<string, number>();
  for (const r of rows) tot.set(r.platform, (tot.get(r.platform) ?? 0) + r.n);
  const groups = [...tot.entries()].filter(([, n]) => n >= 500).sort((a, b) => b[1] - a[1]).map(([p]) => {
    const parts: Record<string, number> = {};
    for (const r of rows.filter((r) => r.platform === p)) parts[fold(r.licence_class)] = (parts[fold(r.licence_class)] ?? 0) + r.n;
    return { label: PNAME[p] ?? p, parts };
  });
  charts["licence-classes"] = stacked({
    title: "Licence classes of data records",
    subtitle: "Classified from each record's licence field, as an agent reading the API sees it. Platforms with 500+ data records.", labelW: 170,
    keys: [{ key: "open", label: "Open" }, { key: "unclear", label: "Terms page or unclear" }, { key: "none", label: "None" }, { key: "non_commercial", label: "Non-commercial" }, { key: "restricted", label: "Restricted" }],
    groups,
  });
}

// 5. CKAN DataStore coverage by portal.
{
  const rows = await q(`select replace(replace(d.source_id, 'ckan:', ''), '/data', '') as portal, count(distinct d.id)::int as n,
      count(distinct d.id) filter (where r.datastore)::int as ds
    from datasets d join resources r on r.dataset_id = d.id
    where d.source_id like 'ckan:%' and d.duplicate_of is null and d.record_kind = 'data' group by 1 order by ds * 1.0 / n desc`);
  const NAMES: Record<string, string> = { "www.donneesquebec.ca": "Données Québec", "donnees.montreal.ca": "Montréal", "ckan0.cf.opendata.inter.prod-toronto.ca": "Toronto", "canwin-datahub.ad.umanitoba.ca": "CanWIN", "catalogue.data.gov.bc.ca": "BC Data Catalogue", "data.cbwaterhub.ca": "Columbia Basin Water Hub", "niagaraopendata.ca": "Niagara Open Data" };
  charts["datastore-by-portal"] = hbars({
    title: "CKAN DataStore coverage by portal",
    subtitle: "Share of each CKAN portal's data records with a resource in the DataStore (queryable row by row)",
    rows: rows.map((r) => ({ label: NAMES[r.portal] ?? r.portal, value: (r.ds / r.n) * 100, display: `${pct((r.ds / r.n) * 100)} of ${fmt(r.n)}` })),
    max: 100, labelW: 180, ticks: [0, 25, 50, 75, 100], tickFmt: (n) => `${n}%`,
  });
}

// 6. Best resource per data record.
{
  const rows = await q(`select coalesce(best_tier, 'none') as tier, count(*)::int as n from datasets where duplicate_of is null and record_kind = 'data' group by 1`);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const TIERS: [string, string][] = [["tabular_file", "Tabular file (CSV, XLSX, JSON)"], ["live_query", "Live query API"], ["geo_file", "GIS file (SHP, KML, GDB)"], ["document", "Document only (PDF, HTML)"], ["link_only", "Link, unknown content"], ["none", "No resources"]];
  const by = Object.fromEntries(rows.map((r) => [r.tier, r.n]));
  charts["best-resource"] = hbars({
    title: "Best resource per data record",
    subtitle: `How an agent can get each of ${fmt(total)} unique data records (CKAN and ArcGIS Hub)`,
    rows: TIERS.map(([k, label]) => ({ label, value: by[k] ?? 0, display: `${fmt(by[k] ?? 0)} (${pct(((by[k] ?? 0) / total) * 100)})` })),
    labelW: 210, ticks: [0, 10000, 20000],
  });
}

// 7. Sources by access pattern (archetype and status).
{
  const rows = await q(`select case
      when archetype = 'platform_api' and status = 'harvested' then 'Catalog API, harvested'
      when archetype = 'platform_api' and status in ('identified', 'harvestable') then 'Catalog API, not yet harvested'
      when archetype = 'known_api' and status <> 'not_data' then 'Bespoke API'
      when archetype = 'esri_rest' and status <> 'not_data' then 'Esri map server'
      when archetype = 'web_listing' then 'Web page of data files'
      when archetype = 'platform_api' and status = 'proposed' then 'Blocked catalog API'
      when status = 'not_data' then 'Checked, not a data source'
      else 'Other' end as pattern, count(*)::int as n
    from sources where status <> 'needs_profiling' group by 1 order by n desc`);
  charts["access-patterns"] = hbars({
    title: "Sources by access pattern",
    subtitle: "How an agent reaches each identified source (one org can have several)",
    rows: rows.map((r) => ({ label: r.pattern, value: r.n, display: fmt(r.n) })),
    labelW: 210, ticks: [0, 50, 100, 150],
  });
}

// 8–9. Org readiness by type and by province (best source per org, same rule as the digest).
{
  const BEST = `with best as (
      select o.id, o.org_type, o.province, max(case when s.status in ('identified','harvestable','harvested') then 3 when s.status in ('proposed','needs_human','blocked') then 2 when s.id is not null then 1 else 0 end) as r
      from orgs o left join org_sources os on os.org_id = o.id left join sources s on s.id = os.source_id group by all)`;
  const keys = [{ key: "3", label: "Source identified" }, { key: "2", label: "Blocked or in review" }, { key: "1", label: "Not a data source" }, { key: "0", label: "Dead link or no URL" }];
  const grouped = (rows: Record<string, any>[], dim: string) => {
    const groups = new Map<string, Record<string, number>>();
    for (const r of rows) { const g = groups.get(r[dim]) ?? {}; g[String(r.r)] = r.n; groups.set(r[dim], g); }
    return [...groups.entries()].map(([label, parts]) => ({ label, parts })).sort((a, b) => Object.values(b.parts).reduce((x, y) => x + y, 0) - Object.values(a.parts).reduce((x, y) => x + y, 0));
  };
  const TYPES: Record<string, string> = { "Municipal Government": "Municipal", "Provincial Agency": "Provincial agency", "Provincial / Territorial Government": "Provincial / territorial", "National/Federal Government": "Federal", "Indigenous Government": "Indigenous government", "Crown corporation": "Crown corporation" };
  const byType = (await q(`${BEST} select coalesce(org_type, '?') as org_type, r, count(*)::int as n from best group by all`)).map((r) => ({ ...r, org_type: TYPES[r.org_type] ?? r.org_type }));
  charts["readiness-by-org-type"] = stacked({ title: "Organizations with a usable source, by type", subtitle: "Best source per organization in the directory", keys, groups: grouped(byType, "org_type"), unit: "orgs" });
  const byProv = await q(`${BEST} select coalesce(province, '?') as province, r, count(*)::int as n from best where province is not null and province <> '?' group by all`);
  charts["readiness-by-province"] = stacked({ title: "Organizations with a usable source, by province", subtitle: "Best source per organization in the directory", keys, groups: grouped(byProv, "province"), unit: "orgs" });
}

mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(charts)) writeFileSync(join(OUT, `${name}.svg`), svg);
console.log(`wrote ${Object.keys(charts).length} charts to ${OUT}`);
await closeDb(conn);
