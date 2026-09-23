import type {
  CanonicalField,
  CanonicalRecord,
  CanonicalSchema,
  JsonObject,
  NormalizedRow,
  ProductDeclaration,
  ProductFinalization,
  StreamingTransform,
  TransformContext,
  TransformQuality,
} from "#/index";
import { GatekeeperError, field } from "#/index";
import { GtfsCsvReader, type GtfsRow } from "./csv";
import { requestedGtfsFiles } from "./gtfs";
import { gtfsZipEntries, MAX_ENTRY_BYTES } from "./zip";

export const GTFS_NORMALIZER = { id: "gtfs-schedule", version: "3" };

/**
 * Most shapes.txt points held while they are assembled into LineStrings, which
 * needs every point of a path before its first record: three float64 values
 * per point, so 24 MB at the bound. It is the only state that grows with the
 * archive; every other file streams row by row. Past it the collection fails.
 */
export const MAX_PATH_POINTS = 1_000_000;

export interface GtfsTransformLimits {
  maximumEntryBytes: number;
  maximumPathPoints: number;
}

/** Turns one GTFS file's rows into records. */
interface EntryNormalizer {
  rejected: number;
  /** The record this row completes; undefined when it was rejected or is held for `end`. */
  row(row: GtfsRow): CanonicalRecord | undefined;
  /** Records only known once the whole file was read. */
  end(): Iterable<CanonicalRecord>;
}

interface GtfsProduct {
  /** GTFS file name without `.txt`. */
  file: string;
  productKey: string;
  titleSuffix: string;
  description: string;
  schema: CanonicalSchema;
  start(limits: GtfsTransformLimits): EntryNormalizer;
}

interface GtfsRun {
  accepted: number;
  rejected: number;
  seen: Set<string>;
}

const STOP_SCHEMA = schema([
  field("stop_id", "identifier", false),
  field("stop_name", "string", true),
  field("stop_code", "identifier", true),
  field("latitude", "latitude", true),
  field("longitude", "longitude", true),
  field("location_type", "category", true),
  field("wheelchair_boarding", "category", true),
  field("zone_id", "category", true),
  field("parent_station", "identifier", true),
]);

const ROUTE_SCHEMA = schema([
  field("route_id", "identifier", false),
  {
    ...field("route_short_name", "string", true),
    display: { badge: { colorField: "route_color", textColorField: "route_text_color" } },
  },
  field("route_long_name", "string", true),
  field("route_type", "category", true),
  field("route_type_code", "identifier", true),
  field("route_color", "color", true),
  field("route_text_color", "color", true),
  field("agency_id", "category", true),
]);

const AGENCY_SCHEMA = schema([
  field("agency_id", "identifier", false),
  field("agency_name", "string", false),
  field("agency_url", "url", false),
  field("agency_timezone", "category", false),
  field("agency_lang", "category", true),
  field("agency_phone", "string", true),
  field("agency_fare_url", "url", true),
  field("agency_email", "string", true),
]);

const CALENDAR_SCHEMA = schema([
  field("service_id", "identifier", false),
  field("monday", "boolean", false),
  field("tuesday", "boolean", false),
  field("wednesday", "boolean", false),
  field("thursday", "boolean", false),
  field("friday", "boolean", false),
  field("saturday", "boolean", false),
  field("sunday", "boolean", false),
  field("start_date", "date", false),
  field("end_date", "date", false),
]);

const CALENDAR_DATES_SCHEMA = schema([field("service_id", "identifier", false), field("date", "date", false), field("exception_type", "category", false)]);

const TRIP_SCHEMA = schema([
  field("trip_id", "identifier", false),
  field("route_id", "identifier", false),
  field("service_id", "identifier", false),
  field("trip_headsign", "string", true),
  field("trip_short_name", "string", true),
  field("direction_id", "category", true),
  field("block_id", "identifier", true),
  field("shape_id", "identifier", true),
  field("wheelchair_accessible", "category", true),
  field("bikes_allowed", "category", true),
]);

const PATH_SCHEMA = schema([
  field("shape_id", "identifier", false),
  field("geometry", "geometry", false),
  field("latitude", "latitude", false),
  field("longitude", "longitude", false),
  field("point_count", "number", false, "point"),
]);

/** Every product this Gatekeeper can build, in the order products are declared. */
const GTFS_PRODUCTS: readonly GtfsProduct[] = [
  {
    file: "stops",
    productKey: "stops",
    titleSuffix: "stops",
    description: "Stops and stations with their published coordinates and accessibility categories.",
    schema: STOP_SCHEMA,
    start: () => new RowByRow(stopRecord),
  },
  {
    file: "routes",
    productKey: "routes",
    titleSuffix: "routes",
    description: "Transit routes with their names, modes, operators, and display colours.",
    schema: ROUTE_SCHEMA,
    start: () => new RowByRow(routeRecord),
  },
  {
    file: "agency",
    productKey: "agencies",
    titleSuffix: "agencies",
    description: "Transit agencies named by this GTFS schedule feed.",
    schema: AGENCY_SCHEMA,
    start: () => new AgencyRows(),
  },
  {
    file: "calendar",
    productKey: "calendar",
    titleSuffix: "service calendar",
    description: "Regular weekly service periods from the GTFS schedule.",
    schema: CALENDAR_SCHEMA,
    start: () => new RowByRow(calendarRecord),
  },
  {
    file: "calendar_dates",
    productKey: "calendar-dates",
    titleSuffix: "calendar exceptions",
    description: "Dates on which scheduled service is added or removed.",
    schema: CALENDAR_DATES_SCHEMA,
    start: () => new RowByRow(calendarDateRecord),
  },
  {
    file: "trips",
    productKey: "trips",
    titleSuffix: "trips",
    description: "Scheduled trips and their route, service, direction, and shape references.",
    schema: TRIP_SCHEMA,
    start: () => new RowByRow(tripRecord),
  },
  {
    file: "shapes",
    productKey: "shapes",
    titleSuffix: "shapes",
    description: "Route shapes assembled as ordered GeoJSON LineStrings.",
    schema: PATH_SCHEMA,
    start: (limits) => new PathLines(limits.maximumPathPoints),
  },
];

/**
 * Normalize a GTFS Schedule ZIP as it streams. Products are declared from the
 * requested files before the archive is read, because a streamed ZIP only
 * reveals its entries in order; a requested file the archive lacks yields an
 * empty product and a warning. Rows are pulled one at a time, one entry at a
 * time, so the working set is one inflated chunk, one partial CSV row, and the
 * bounded shapes.txt aggregation.
 */
export function transformGtfs(
  body: ReadableStream<Uint8Array>,
  context: TransformContext,
  limits: GtfsTransformLimits = { maximumEntryBytes: MAX_ENTRY_BYTES, maximumPathPoints: MAX_PATH_POINTS },
): StreamingTransform {
  const files = requestedGtfsFiles(context.feed.config.files);
  const baseSlug = context.feed.slug.replace(/-feed$/, "");
  const products = GTFS_PRODUCTS.filter((product) => files.includes(product.file));
  const run: GtfsRun = { accepted: 0, rejected: 0, seen: new Set() };
  return {
    products: products.map((product) => declaration(product, baseSlug, context.feed.title)),
    rows: normalizedRows(body, products, limits, run),
    finish: () => ({ quality: quality(run), products: missingProducts(products, run) }),
  };
}

/**
 * A declared file the archive turned out not to contain says nothing about
 * that product's current state: report it as unknown so the kernel keeps what
 * it already serves instead of treating an empty product as authoritative.
 */
function missingProducts(products: readonly GtfsProduct[], run: GtfsRun): ProductFinalization[] {
  return products.filter((product) => !run.seen.has(`${product.file}.txt`)).map((product) => ({ productKey: product.productKey, completeness: "unknown" }));
}

async function* normalizedRows(body: ReadableStream<Uint8Array>, products: readonly GtfsProduct[], limits: GtfsTransformLimits, run: GtfsRun): AsyncGenerator<NormalizedRow> {
  const byEntry = new Map(products.map((product) => [`${product.file}.txt`, product]));
  const entries = gtfsZipEntries(body, new Set(byEntry.keys()), { maximumEntryBytes: limits.maximumEntryBytes });
  for await (const entry of entries) {
    const product = byEntry.get(entry.name);
    if (!product) throw new Error(`GTFS entry ${entry.name} was not requested`);
    run.seen.add(entry.name);
    const normalizer = product.start(limits);
    const reader = new GtfsCsvReader();
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    for await (const chunk of entry.chunks) {
      for (const row of reader.push(decodeText(decoder, entry.name, chunk))) {
        const record = normalizer.row(row);
        if (!record) continue;
        run.accepted += 1;
        yield { productKey: product.productKey, record };
      }
    }
    for (const row of [...reader.push(decodeText(decoder, entry.name)), ...reader.finish()]) {
      const record = normalizer.row(row);
      if (!record) continue;
      run.accepted += 1;
      yield { productKey: product.productKey, record };
    }
    for (const record of normalizer.end()) {
      run.accepted += 1;
      yield { productKey: product.productKey, record };
    }
    run.rejected += normalizer.rejected;
  }
}

function decodeText(decoder: TextDecoder, name: string, chunk?: Uint8Array): string {
  try {
    return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
  } catch {
    throw new GatekeeperError(`GTFS entry ${name} was not valid UTF-8`, "invalid-response");
  }
}

function declaration(product: GtfsProduct, baseSlug: string, feedTitle: string): ProductDeclaration {
  return {
    productKey: product.productKey,
    slug: `${baseSlug}-${product.productKey}`,
    title: `${feedTitle} ${product.titleSuffix}`,
    description: product.description,
    role: "reference",
    kind: "record",
    schema: product.schema,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
}

function quality(run: GtfsRun): TransformQuality {
  return { acceptedRecords: run.accepted, rejectedRecords: run.rejected };
}

/** One record per row, or a rejection. */
class RowByRow implements EntryNormalizer {
  rejected = 0;

  private readonly convert: (row: GtfsRow) => CanonicalRecord | undefined;

  constructor(convert: (row: GtfsRow) => CanonicalRecord | undefined) {
    this.convert = convert;
  }

  row(row: GtfsRow): CanonicalRecord | undefined {
    const converted = this.convert(row);
    if (!converted) this.rejected += 1;
    return converted;
  }

  end(): Iterable<CanonicalRecord> {
    return [];
  }
}

/**
 * GTFS permits an empty agency_id only when the feed has exactly one agency, so
 * a first row without one is held until a second row shows it was not alone.
 */
class AgencyRows implements EntryNormalizer {
  rejected = 0;
  private rows = 0;
  private unnamed: GtfsRow | undefined;

  row(row: GtfsRow): CanonicalRecord | undefined {
    this.rows += 1;
    if (this.unnamed) {
      this.unnamed = undefined;
      this.rejected += 1;
    }
    if (this.rows === 1 && !required(row.agency_id)) {
      this.unnamed = row;
      return undefined;
    }
    const converted = agencyRecord(row);
    if (!converted) this.rejected += 1;
    return converted;
  }

  *end(): Generator<CanonicalRecord> {
    if (!this.unnamed) return;
    const converted = agencyRecord(this.unnamed, "default");
    this.unnamed = undefined;
    if (converted) yield converted;
    else this.rejected += 1;
  }
}

/**
 * shapes.txt rows are points; a record is a whole path, ordered by
 * shape_pt_sequence, so points are held until the file ends. Each path keeps
 * flat [sequence, longitude, latitude] triples, and is released as it is emitted.
 */
class PathLines implements EntryNormalizer {
  rejected = 0;
  private points = 0;
  private readonly paths = new Map<string, number[]>();

  private readonly maximumPoints: number;

  constructor(maximumPoints: number) {
    this.maximumPoints = maximumPoints;
  }

  row(row: GtfsRow): CanonicalRecord | undefined {
    const id = required(row["shape_id"]);
    const latitude = finiteNumber(row["shape_pt_lat"]);
    const longitude = finiteNumber(row["shape_pt_lon"]);
    const sequence = finiteNumber(row["shape_pt_sequence"]);
    if (!id || latitude === undefined || longitude === undefined || sequence === undefined) {
      this.rejected += 1;
      return undefined;
    }
    this.points += 1;
    if (this.points > this.maximumPoints) {
      throw new GatekeeperError(`GTFS shapes.txt has more than ${this.maximumPoints} points to assemble`, "response-too-large");
    }
    let triples = this.paths.get(id);
    if (!triples) {
      triples = [];
      this.paths.set(id, triples);
    }
    triples.push(sequence, longitude, latitude);
    return undefined;
  }

  *end(): Generator<CanonicalRecord> {
    for (const [id, triples] of this.paths) {
      this.paths.delete(id);
      const count = triples.length / 3;
      if (count < 2) {
        this.rejected += count;
        continue;
      }
      // Stable by file order when two points share a sequence number.
      const order = Array.from({ length: count }, (_, index) => index).sort((left, right) => (triples[left * 3] ?? 0) - (triples[right * 3] ?? 0) || left - right);
      const coordinates = order.map((index) => [triples[index * 3 + 1] ?? 0, triples[index * 3 + 2] ?? 0]);
      const latitude = coordinates.reduce((total, point) => total + (point[1] ?? 0), 0) / count;
      const longitude = coordinates.reduce((total, point) => total + (point[0] ?? 0), 0) / count;
      yield record(id, {
        "shape_id": id,
        geometry: { type: "LineString", coordinates },
        latitude,
        longitude,
        point_count: count,
      });
    }
  }
}

function stopRecord(row: GtfsRow): CanonicalRecord | undefined {
  const id = required(row.stop_id);
  if (!id) return undefined;
  return record(id, {
    stop_id: id,
    stop_name: nullable(row.stop_name),
    stop_code: nullable(row.stop_code),
    latitude: nullableNumber(row.stop_lat),
    longitude: nullableNumber(row.stop_lon),
    location_type: categoryCode(row.location_type, LOCATION_TYPES),
    wheelchair_boarding: categoryCode(row.wheelchair_boarding, WHEELCHAIR_BOARDING),
    zone_id: nullable(row.zone_id),
    parent_station: nullable(row.parent_station),
  });
}

function routeRecord(row: GtfsRow): CanonicalRecord | undefined {
  const id = required(row.route_id);
  if (!id) return undefined;
  const code = nullable(row.route_type);
  return record(id, {
    route_id: id,
    route_short_name: nullable(row.route_short_name),
    route_long_name: nullable(row.route_long_name),
    route_type: code ? routeType(code) : null,
    route_type_code: code,
    route_color: color(row.route_color),
    route_text_color: color(row.route_text_color),
    agency_id: nullable(row.agency_id),
  });
}

function agencyRecord(row: GtfsRow, fallbackId?: string): CanonicalRecord | undefined {
  const id = required(row.agency_id) ?? fallbackId;
  const name = required(row.agency_name);
  const url = validUrl(row.agency_url);
  const timezone = required(row.agency_timezone);
  if (!id || !name || !url || !timezone) return undefined;
  return record(id, {
    agency_id: id,
    agency_name: name,
    agency_url: url,
    agency_timezone: timezone,
    agency_lang: nullable(row.agency_lang),
    agency_phone: nullable(row.agency_phone),
    agency_fare_url: validUrl(row.agency_fare_url),
    agency_email: nullable(row.agency_email),
  });
}

function calendarRecord(row: GtfsRow): CanonicalRecord | undefined {
  const id = required(row.service_id);
  const startDate = gtfsDate(row.start_date);
  const endDate = gtfsDate(row.end_date);
  const weekdays = WEEKDAYS.map((day) => gtfsBoolean(row[day]));
  if (!id || !startDate || !endDate || weekdays.some((value) => value === null)) return undefined;
  return record(id, {
    service_id: id,
    monday: weekdays[0] ?? null,
    tuesday: weekdays[1] ?? null,
    wednesday: weekdays[2] ?? null,
    thursday: weekdays[3] ?? null,
    friday: weekdays[4] ?? null,
    saturday: weekdays[5] ?? null,
    sunday: weekdays[6] ?? null,
    start_date: startDate,
    end_date: endDate,
  });
}

function calendarDateRecord(row: GtfsRow): CanonicalRecord | undefined {
  const serviceId = required(row.service_id);
  const date = gtfsDate(row.date);
  const exception = categoryCode(row.exception_type, EXCEPTION_TYPES);
  if (!serviceId || !date || !exception) return undefined;
  return record(`${serviceId}:${date}`, {
    service_id: serviceId,
    date,
    exception_type: exception,
  });
}

function tripRecord(row: GtfsRow): CanonicalRecord | undefined {
  const tripId = required(row.trip_id);
  const routeId = required(row.route_id);
  const serviceId = required(row.service_id);
  if (!tripId || !routeId || !serviceId) return undefined;
  return record(tripId, {
    trip_id: tripId,
    route_id: routeId,
    service_id: serviceId,
    trip_headsign: nullable(row.trip_headsign),
    trip_short_name: nullable(row.trip_short_name),
    direction_id: categoryCode(row.direction_id, DIRECTION_TYPES),
    block_id: nullable(row.block_id),
    "shape_id": nullable(row["shape_id"]),
    wheelchair_accessible: categoryCode(row.wheelchair_accessible, ACCESS_TYPES),
    bikes_allowed: categoryCode(row.bikes_allowed, BIKES_TYPES),
  });
}

function record(entityKey: string, payload: JsonObject): CanonicalRecord {
  return { entityKey, payload };
}

function schema(fields: CanonicalField[]): CanonicalSchema {
  return { fields };
}

function required(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function nullable(value: string | undefined): string | null {
  return value?.trim() || null;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nullableNumber(value: string | undefined): number | null {
  return finiteNumber(value) ?? null;
}

function validUrl(value: string | undefined): string | null {
  const candidate = nullable(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function gtfsBoolean(value: string | undefined): boolean | null {
  return value === "1" ? true : value === "0" ? false : null;
}

function gtfsDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function color(value: string | undefined): string | null {
  const candidate = value?.trim().replace(/^#/, "");
  return candidate && /^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(candidate) ? `#${candidate.toUpperCase()}` : null;
}

function categoryCode(value: string | undefined, labels: Readonly<Record<string, string>>): string | null {
  const code = nullable(value);
  if (!code) return null;
  return `${labels[code] ?? "Unknown"} (${code})`;
}

function routeType(code: string): string {
  const numeric = Number(code);
  const label =
    ROUTE_TYPES[code] ??
    (numeric >= 100 && numeric < 200
      ? "Railway service"
      : numeric >= 200 && numeric < 300
        ? "Coach service"
        : numeric >= 700 && numeric < 800
          ? "Bus service"
          : numeric >= 900 && numeric < 1000
            ? "Tram service"
            : numeric >= 1000 && numeric < 1100
              ? "Water transport service"
              : numeric >= 1300 && numeric < 1400
                ? "Aerial lift service"
                : "Unknown route type");
  return `${label} (${code})`;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const LOCATION_TYPES = { "0": "Stop or platform", "1": "Station", "2": "Entrance or exit", "3": "Generic node", "4": "Boarding area" };
const WHEELCHAIR_BOARDING = { "0": "No information", "1": "Possible", "2": "Not possible" };
const EXCEPTION_TYPES = { "1": "Service added", "2": "Service removed" };
const DIRECTION_TYPES = { "0": "Outbound", "1": "Inbound" };
const ACCESS_TYPES = { "0": "No information", "1": "Accessible", "2": "Not accessible" };
const BIKES_TYPES = { "0": "No information", "1": "Allowed", "2": "Not allowed" };
/** GTFS route type codes and the vehicle each one names. */
interface RouteTypeLabels {
  [code: string]: string;
}

const ROUTE_TYPES: RouteTypeLabels = {
  "0": "Tram, streetcar, or light rail",
  "1": "Subway or metro",
  "2": "Rail",
  "3": "Bus",
  "4": "Ferry",
  "5": "Cable tram",
  "6": "Aerial lift",
  "7": "Funicular",
  "11": "Trolleybus",
  "12": "Monorail",
};
