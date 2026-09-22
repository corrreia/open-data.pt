import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type Transformer,
  type UnstampedResult,
} from "../../index";
import { SNIRH_READINGS, decodeEntities, isSnirhReading, parseReadingsCsv, validateSnirhFeedConfig, type SnirhDocument, type SnirhReadingName, type SnirhStation } from "./snirh";

const SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

const GROUNDWATER_SCHEMA: CanonicalSchema = {
  fields: [
    field("month", "date", false),
    field("aquiferId", "identifier", false, undefined, "Aquifer ID"),
    field("aquifer", "string", false),
    field("state", "category", false),
    field("stateLabel", "category", false, undefined, "State"),
  ],
};

/** The groundwater bulletin's three classes: where the month's levels sit against the aquifer's own record. */
const GROUNDWATER_STATES = new Map([
  ["SUP_MEDIA", "Above the monthly mean"],
  ["SUP_P20_INF_MEDIA", "Below the monthly mean, above the 20th percentile"],
  ["INF_P20", "Below the 20th percentile"],
]);

const MONTHS = new Map([
  ["OUT", 10],
  ["NOV", 11],
  ["DEZ", 12],
  ["JAN", 1],
  ["FEV", 2],
  ["MAR", 3],
  ["ABR", 4],
  ["MAI", 5],
  ["JUN", 6],
  ["JUL", 7],
  ["AGO", 8],
  ["SET", 9],
]);

interface Built {
  points?: SeriesPoint[];
  records?: CanonicalRecord[];
  rejected: number;
}

export class SnirhTransformer implements Transformer {
  readonly id = "snirh";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = validateSnirhFeedConfig(context.feed.config);
    const document = parseDocument(parseJsonBytes(bytes));
    if (document.kind !== config.feed) throw new GatekeeperError(`SNIRH collected ${document.kind} for a ${config.feed ?? "?"} feed`, "invalid-response");
    if (document.kind === "readings" && document.reading !== config.reading)
      throw new GatekeeperError(`SNIRH collected ${document.reading} for a ${config.reading ?? "?"} feed`, "invalid-response");
    const built = build(document, context.observedAt.slice(0, 7));
    // A history slice may reach past its cursor, as the source counts in whole days, months or years; what lies past it the
    // walk has already seen.
    const before = document.before;
    const inWindow = (time: string | undefined): boolean => before === undefined || (time !== undefined && time < before);
    const slug = context.feed.slug.replace(/-feed$/u, "");
    if (built.records) {
      const records = built.records.filter((record) => inWindow(record.eventTime));
      const watermark = records
        .map((record) => record.eventTime ?? "")
        .sort()
        .at(-1);
      const product: ProductBuild = {
        productKey: document.kind,
        slug,
        title: context.feed.title,
        description: context.feed.description,
        role: "summary",
        kind: "record",
        schema: GROUNDWATER_SCHEMA,
        records,
        // Each collection sees a few months; months already published accumulate.
        updateMode: "delta",
        completeness: "complete",
      };
      if (watermark) product.watermark = watermark;
      return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: built.rejected } };
    }
    const points = (built.points ?? []).filter((point) => inWindow(point.eventTime));
    const watermark = points
      .map((point) => point.eventTime)
      .sort()
      .at(-1);
    const product: ProductBuild = {
      productKey: document.kind === "readings" ? document.reading : document.kind,
      slug,
      title: context.feed.title,
      description: context.feed.description,
      role: "time-series",
      kind: "series",
      schema: SERIES_SCHEMA,
      points,
      updateMode: "source-window",
      completeness: "complete",
    };
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: points.length, rejectedRecords: built.rejected } };
  }
}

function build(document: SnirhDocument, currentMonth: string): Built {
  switch (document.kind) {
    case "readings":
      return readings(document.reading, document.stations, document.tables);
    case "monthly-precipitation":
      return precipitation(document.months, currentMonth);
    case "reservoir-basins":
      return reservoirs(document.years);
    default:
      return groundwater(document.months);
  }
}

function readings(reading: SnirhReadingName, stations: SnirhStation[], tables: Array<{ sites: string[]; csv: string }>): Built {
  const definition = SNIRH_READINGS[reading];
  const bySite = new Map(stations.map((station) => [station.site, station]));
  const points: SeriesPoint[] = [];
  let rejected = 0;
  for (const table of tables) {
    const parsed = parseReadingsCsv(table.csv);
    if (parsed.columns.length !== table.sites.length) throw new GatekeeperError("SNIRH readings lost track of which column is which station", "invalid-response");
    for (const row of parsed.rows) {
      row.cells.forEach((cell, index) => {
        if (cell.value === "") return;
        const station = bySite.get(table.sites[index] ?? "");
        const value = Number(cell.value);
        if (!station || !Number.isFinite(value)) {
          rejected += 1;
          return;
        }
        const dimensions: SeriesPoint["dimensions"] = { station: station.code, name: station.name };
        if (cell.flag !== "") dimensions.flag = cell.flag;
        points.push({ seriesKey: station.code, eventTime: row.time, value, unit: definition.unit, dimensions });
      });
    }
  }
  return { points, rejected };
}

/**
 * The precipitation bulletin's XML, one `<data>` per station, among a few
 * regional entries that carry no station code. The month still under way is
 * left out: its total grows every day until the month ends.
 */
function precipitation(months: Array<{ month: string; xml: string }>, currentMonth: string): Built {
  const points: SeriesPoint[] = [];
  let rejected = 0;
  for (const { month, xml } of months) {
    if (month >= currentMonth) continue;
    for (const entry of xml.matchAll(/<data>([\s\S]*?)<\/data>/gu)) {
      const block = entry[1] ?? "";
      const code = tag(block, "simbolo");
      const total = tag(block, "precipit_valor");
      if (!code || !/^\d{2}[A-Z]\/\d{2}[A-Z]+$/u.test(code) || total === undefined || total === "") continue;
      const value = Number(total);
      if (!Number.isFinite(value)) {
        rejected += 1;
        continue;
      }
      const dimensions: SeriesPoint["dimensions"] = { station: code, name: tag(block, "estacao_nome") ?? "" };
      const normal = tag(block, "precipit_media_mensal");
      if (normal && Number.isFinite(Number(normal))) dimensions.normalMm = normal;
      points.push({ seriesKey: code, eventTime: `${month}-01T00:00:00.000Z`, value, unit: "mm", dimensions });
    }
  }
  return { points, rejected };
}

/**
 * The reservoir table by basin: a row of basin names, a row of capacities, then
 * blocks of twelve month rows — the monthly means, and one block per
 * hydrological year (`2025/26(%)`). Only the years are read; `n/d` is a month
 * not yet published.
 */
function reservoirs(years: Array<{ hydrologicalYear: number; html: string }>): Built {
  const points: SeriesPoint[] = [];
  let rejected = 0;
  for (const { html } of years) {
    const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
      [...(row[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cell) =>
        decodeEntities((cell[1] ?? "").replace(/<[^>]*>/gu, ""))
          .replace(/\s+/gu, " ")
          .trim(),
      ),
    );
    const namesRow = rows.find((cells) => cells.length > 2 && cells[0] === "" && cells[1] === "" && cells.slice(2).every((cell) => cell !== ""));
    const capacityRow = rows.find((cells) => /^Capacidade/iu.test(cells[0] ?? ""));
    if (!namesRow || !capacityRow) throw new GatekeeperError("SNIRH reservoir table has no basin header", "invalid-response");
    const basins = namesRow.slice(2);
    const capacities = capacityRow.slice(1);
    if (capacities.length !== basins.length) throw new GatekeeperError("SNIRH reservoir table has a capacity per basin missing", "invalid-response");
    let block: number | undefined;
    for (const cells of rows) {
      let monthCell: string | undefined;
      let values: string[];
      if (cells.length === basins.length + 2) {
        const year = /^(\d{4})\/\d{2}\s*\(%\)$/u.exec(cells[0] ?? "");
        block = year ? Number(year[1]) : undefined;
        monthCell = cells[1];
        values = cells.slice(2);
      } else if (cells.length === basins.length + 1 && MONTHS.has(cells[0] ?? "")) {
        monthCell = cells[0];
        values = cells.slice(1);
      } else continue;
      const number = MONTHS.get(monthCell ?? "");
      if (block === undefined || number === undefined) continue;
      const month = `${number >= 10 ? block : block + 1}-${String(number).padStart(2, "0")}`;
      values.forEach((text, index) => {
        if (text === "n/d" || text === "") return;
        const value = Number(text.replace(/\s/gu, ""));
        const basin = basins[index] ?? "";
        if (!Number.isFinite(value) || basin === "") {
          rejected += 1;
          return;
        }
        points.push({
          seriesKey: basinKey(basin),
          eventTime: `${month}-01T00:00:00.000Z`,
          value,
          unit: "%",
          dimensions: { basin, capacityHm3: (capacities[index] ?? "").replace(/\s/gu, "") },
        });
      });
    }
  }
  return { points, rejected };
}

function groundwater(months: Array<{ month: string; xml: string }>): Built {
  const records: CanonicalRecord[] = [];
  let rejected = 0;
  for (const { month, xml } of months) {
    for (const entry of xml.matchAll(/<massaagua>([\s\S]*?)<\/massaagua>/gu)) {
      const block = entry[1] ?? "";
      const state = tag(block, "classe");
      // An aquifer without a class had no reading that month.
      if (!state) continue;
      const aquiferId = tag(block, "codigoid");
      const aquifer = tag(block, "nome");
      const label = GROUNDWATER_STATES.get(state);
      if (!aquiferId || !aquifer || !label) {
        rejected += 1;
        continue;
      }
      records.push({
        entityKey: `${aquiferId}:${month}`,
        eventTime: `${month}-01T00:00:00.000Z`,
        payload: { month: `${month}-01`, aquiferId, aquifer, state, stateLabel: label },
      });
    }
  }
  return { records, rejected };
}

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(block);
  return match ? decodeEntities(match[1] ?? "").trim() : undefined;
}

function basinKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function parseDocument(value: JsonValue): SnirhDocument {
  if (!isJsonObject(value) || !isJsonString(value.kind)) throw new GatekeeperError("SNIRH collection is not a document", "invalid-response");
  const before = isJsonString(value.before) ? value.before : undefined;
  const withBefore = <T extends SnirhDocument>(document: T): T => (before === undefined ? document : { ...document, before });
  switch (value.kind) {
    case "readings": {
      const reading = isJsonString(value.reading) ? value.reading : undefined;
      if (!isSnirhReading(reading) || !isJsonArray(value.stations) || !isJsonArray(value.tables))
        throw new GatekeeperError("SNIRH readings document is malformed", "invalid-response");
      const stations = value.stations.map((station): SnirhStation => {
        if (!isJsonObject(station) || !isJsonString(station.site) || !isJsonString(station.code) || !isJsonString(station.name))
          throw new GatekeeperError("SNIRH readings document has a malformed station", "invalid-response");
        return { site: station.site, code: station.code, name: station.name };
      });
      const tables = value.tables.map((table) => {
        if (!isJsonObject(table) || !isJsonArray(table.sites) || !isJsonString(table.csv) || !table.sites.every(isJsonString))
          throw new GatekeeperError("SNIRH readings document has a malformed table", "invalid-response");
        return { sites: table.sites.filter(isJsonString), csv: table.csv };
      });
      return withBefore({ kind: "readings", reading, stations, tables });
    }
    case "monthly-precipitation":
    case "groundwater-state": {
      if (!isJsonArray(value.months)) throw new GatekeeperError("SNIRH bulletin document is malformed", "invalid-response");
      const months = value.months.map((entry) => {
        if (!isJsonObject(entry) || !isJsonString(entry.month) || !/^\d{4}-\d{2}$/u.test(entry.month) || !isJsonString(entry.xml))
          throw new GatekeeperError("SNIRH bulletin document has a malformed month", "invalid-response");
        return { month: entry.month, xml: entry.xml };
      });
      return withBefore({ kind: value.kind, months });
    }
    case "reservoir-basins": {
      if (!isJsonArray(value.years)) throw new GatekeeperError("SNIRH reservoir document is malformed", "invalid-response");
      const years = value.years.map((entry) => {
        if (!isJsonObject(entry) || !isJsonNumber(entry.hydrologicalYear) || !isJsonString(entry.html))
          throw new GatekeeperError("SNIRH reservoir document has a malformed year", "invalid-response");
        return { hydrologicalYear: entry.hydrologicalYear, html: entry.html };
      });
      return withBefore({ kind: "reservoir-basins", years });
    }
    default:
      throw new GatekeeperError(`SNIRH collection has an unknown kind ${value.kind}`, "invalid-response");
  }
}
