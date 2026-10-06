/** Resource tier: what an agent can do with a resource. See docs/PLAN.md "Data model". */
export type Tier = "live_query" | "tabular_file" | "geo_file" | "document" | "link_only";

const TABULAR = new Set(["CSV", "TSV", "XLS", "XLSX", "JSON", "GEOJSON", "PARQUET", "XML", "TXT", "ODS", "JSONL",
  "SAV", "POR", "DTA", "XPT", "SAS7BDAT", "RDATA", "RDS", "NETCDF", "NC", "HDF5", "H5"]); // statistical and scientific data formats (research repositories)
const GEO = new Set(["SHP", "KML", "KMZ", "GPKG", "GDB", "FGDB", "GML", "DWG", "DXF", "TIF", "TIFF", "GEOTIFF", "LAS", "LAZ", "E00"]);
const DOCS = new Set(["PDF", "DOC", "DOCX", "PPT", "PPTX", "RTF", "HTML", "HTM", "EPUB"]);
const LIVE = new Set(["ESRI REST", "ARCGIS GEOSERVICES REST API", "WFS", "WMS", "WMTS", "API", "OGC API", "SODA"]);

/** Normalize a free-text format label ("csv", ".CSV", "text/csv", "Esri REST") to an upper-case token. */
export function normalizeFormat(format: string | null | undefined, url?: string | null): string | null {
  let f = (format ?? "").trim().toUpperCase().replace(/^\./, "");
  if (f.includes("/")) f = f.split("/").pop()!.replace(/^VND\.|^X-/, "");
  if (!f && url) f = url.split(/[?#]/)[0].split(".").pop()?.toUpperCase() ?? "";
  if (f === "GEO+JSON") f = "GEOJSON";
  if (f === "MS-EXCEL" || f === "EXCEL") f = "XLS";
  if (f === "OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET") f = "XLSX";
  return f || null;
}

export function tierOf(format: string | null, opts: { datastore?: boolean; url?: string | null; name?: string | null } = {}): Tier {
  if (opts.datastore) return "live_query";
  if (!format) return "link_only";
  if (/CSV|XLS|JSON/.test(format) && !/REST|API/.test(format)) return "tabular_file"; // "CSV ZIPPED", "XLSM", ...
  if (format === "ZIP") {
    // A bare ZIP is only known to be GIS when its name or URL says so.
    const hint = `${opts.url ?? ""} ${opts.name ?? ""}`;
    return /shp|shape|gdb|geodatabase|kml|dwg|gis|lidar/i.test(hint) ? "geo_file" : "link_only";
  }
  if (LIVE.has(format) || /REST|WMS|WFS|API/.test(format)) return "live_query";
  if (TABULAR.has(format)) return "tabular_file";
  if (GEO.has(format)) return "geo_file";
  if (DOCS.has(format)) return "document";
  return "link_only";
}
