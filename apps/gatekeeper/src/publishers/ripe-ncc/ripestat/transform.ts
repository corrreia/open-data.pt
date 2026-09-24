import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedBytes,
  streamJsonArray,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type SeriesPoint,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { asn, endpoint, envelope, hasWarnings, sourceTime, validateCountry, validateRipestatFeedConfig } from "./ripestat";

const DAY_MS = 86_400_000;
const RESOURCE_SCHEMA = { fields: [field("kind", "category", false), field("resource", "identifier", false)] };
const SERIES_SCHEMA = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};
/** What one AS's routing snapshot counts, one series each. */
const STATUS_MEASURES = [
  { key: "ipv4PeersSeeing", unit: "RIS peers", measure: "peers-seeing", ipVersion: "4" },
  { key: "ipv4PeersTotal", unit: "RIS peers", measure: "peers", ipVersion: "4" },
  { key: "ipv6PeersSeeing", unit: "RIS peers", measure: "peers-seeing", ipVersion: "6" },
  { key: "ipv6PeersTotal", unit: "RIS peers", measure: "peers", ipVersion: "6" },
  { key: "ipv4Prefixes", unit: "prefixes", measure: "announced-prefixes", ipVersion: "4" },
  { key: "ipv4Addresses", unit: "IPv4 addresses", measure: "announced-addresses", ipVersion: "4" },
  { key: "ipv6Prefixes", unit: "prefixes", measure: "announced-prefixes", ipVersion: "6" },
  { key: "ipv6Slash48Units", unit: "IPv6 /48 subnet equivalents", measure: "announced-addresses", ipVersion: "6" },
  { key: "observedNeighbours", unit: "ASNs", measure: "observed-neighbours", ipVersion: "" },
] as const;

export class RipestatTransformer {
  readonly id = "ripestat-json";
  readonly version = "1";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const config = validateRipestatFeedConfig(context.feed.config);
    if (config.feed === "routing-status") return status(body, context);
    if (config.feed === "country-resources") return resources(body, context);
    return routing(body, context);
  }
}

function declaration(
  context: TransformContext,
  productKey: string,
  kind: ProductDeclaration["kind"],
  schema: ProductDeclaration["schema"],
  role: ProductDeclaration["role"],
  updateMode: ProductDeclaration["updateMode"],
): ProductDeclaration {
  return {
    productKey,
    slug: context.feed.slug.replace(/-feed$/, ""),
    title: context.feed.title,
    description: context.feed.description,
    kind,
    schema,
    role,
    updateMode,
    completeness: "complete",
  };
}

async function status(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  const root = parseJsonBytes(await readBoundedBytes(body, 64 * 1024));
  const data = envelope(root, "routing-status");
  const number = asn(context.feed.config.asn);
  if (String(data.resource).replace(/^AS/i, "") !== number) throw new GatekeeperError("RIPEstat returned the wrong AS", "invalid-response");
  const visibility = object(data.visibility);
  const v4 = object(visibility.v4);
  const v6 = object(visibility.v6);
  const announced = object(data.announced_space);
  const space4 = object(announced.v4);
  const space6 = object(announced.v6);
  const stamp = sourceTime(data.query_time);
  const counts = {
    ipv4PeersSeeing: count(v4.ris_peers_seeing),
    ipv4PeersTotal: count(v4.total_ris_peers),
    ipv6PeersSeeing: count(v6.ris_peers_seeing),
    ipv6PeersTotal: count(v6.total_ris_peers),
    ipv4Prefixes: count(space4.prefixes),
    ipv4Addresses: count(space4.ips),
    ipv6Prefixes: count(space6.prefixes),
    ipv6Slash48Units: count(space6["48s"], false),
    observedNeighbours: count(data.observed_neighbours),
  } satisfies { [key in (typeof STATUS_MEASURES)[number]["key"]]: number };
  if (counts.ipv4PeersSeeing > counts.ipv4PeersTotal || counts.ipv6PeersSeeing > counts.ipv6PeersTotal)
    throw new GatekeeperError("RIPEstat visibility exceeds its peer population", "invalid-response");
  // Each snapshot adds its moment to every series; an earlier one is never withdrawn.
  const product = declaration(context, "routing-status", "series", SERIES_SCHEMA, "time-series", "delta");
  if (isJsonObject(root) && hasWarnings(root)) product.completeness = "partial";
  async function* rows(): AsyncGenerator<NormalizedRow> {
    for (const measure of STATUS_MEASURES) {
      const dimensions: SeriesPoint["dimensions"] = { measure: measure.measure };
      if (measure.ipVersion) dimensions.ipVersion = measure.ipVersion;
      yield { productKey: "routing-status", point: { seriesKey: measure.key, eventTime: stamp, value: counts[measure.key], unit: measure.unit, dimensions } };
    }
  }
  return {
    products: [product],
    rows: rows(),
    finish: () => ({ quality: { acceptedRecords: STATUS_MEASURES.length, rejectedRecords: 0 }, products: [{ productKey: "routing-status", watermark: stamp }] }),
  };
}

/** IPv4 is the largest list and streams; the smaller ASN/IPv6 lists stay inside a bounded envelope. */
async function resources(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  const stream = streamJsonArray(body, ["data", "resources", "ipv4"], { maxElementBytes: 256, maxEnvelopeBytes: 128 * 1024 });
  const iterator = stream.elements[Symbol.asyncIterator]();
  const first = await iterator.next();
  envelope(stream.envelope(), "country-resource-list");
  let accepted = 0;
  let finished = false;
  let partial = false;
  const seen = new Set<string>();
  function row(kind: string, value: JsonValue): NormalizedRow | undefined {
    const resource = resourceText(kind, value);
    const key = `${kind}:${resource}`;
    if (seen.has(key)) return undefined;
    if (seen.size >= 5000) throw new GatekeeperError("RIPEstat resource list exceeds 5000 resources", "response-too-large");
    seen.add(key);
    accepted += 1;
    return { productKey: "resources", record: { entityKey: key, payload: { kind, resource } } };
  }
  async function* rows(): AsyncGenerator<NormalizedRow> {
    try {
      for (let current = first; !current.done; current = await iterator.next()) {
        const normalized = row("ipv4", current.value);
        if (normalized) yield normalized;
      }
      const root = stream.envelope();
      const data = envelope(root, "country-resource-list");
      sourceTime(data.query_time); // Snapshot coverage only: deliberately not copied onto allocation records.
      const lists = object(data.resources);
      if (!isJsonArray(lists.asn) || !isJsonArray(lists.ipv4) || !isJsonArray(lists.ipv6)) throw new GatekeeperError("RIPEstat omitted an allocation family", "invalid-response");
      for (const kind of ["asn", "ipv6"] as const) {
        const values = lists[kind];
        if (!isJsonArray(values)) throw new GatekeeperError("Invalid RIPEstat resource family", "invalid-response");
        for (const value of values) {
          const normalized = row(kind, value);
          if (normalized) yield normalized;
        }
      }
      partial = hasWarnings(root);
      finished = true;
    } finally {
      await iterator.return?.();
    }
  }
  return {
    products: [declaration(context, "resources", "record", RESOURCE_SCHEMA, "reference", "authoritative-snapshot")],
    rows: rows(),
    finish: () => {
      if (!finished) throw new GatekeeperError("RIPEstat resource stream is incomplete", "invalid-response");
      return { quality: { acceptedRecords: accepted, rejectedRecords: 0 }, products: [{ productKey: "resources", completeness: partial ? "partial" : "complete" }] };
    },
  };
}

const ROUTING_MEASURES = [
  { field: "v4_prefixes_ris", unit: "prefixes", measure: "announced-prefixes", ipVersion: "4", source: "RIS" },
  { field: "v6_prefixes_ris", unit: "prefixes", measure: "announced-prefixes", ipVersion: "6", source: "RIS" },
  { field: "asns_ris", unit: "ASNs", measure: "announced-asns", ipVersion: "", source: "RIS" },
  { field: "asns_stats", unit: "ASNs", measure: "registered-asns", ipVersion: "", source: "RIR statistics" },
] as const;

async function routing(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  const stream = streamJsonArray(body, ["data", "stats"], { maxElementBytes: 64 * 1024, maxEnvelopeBytes: 64 * 1024 });
  const iterator = stream.elements[Symbol.asyncIterator]();
  const first = await iterator.next();
  const data = envelope(stream.envelope(), endpoint(context.feed.config.feed));
  const from = sourceTime(data.query_starttime);
  const before = sourceTime(data.query_endtime);
  const span = Date.parse(before) - Date.parse(from);
  if (span <= 0 || span > Number(context.feed.config.days ?? "30") * DAY_MS) throw new GatekeeperError("RIPEstat returned an unbounded routing interval", "invalid-response");
  const seen = new Map<string, number>();
  let accepted = 0;
  let watermark: string | undefined;
  let finished = false;
  let partial = false;
  async function* rows(): AsyncGenerator<NormalizedRow> {
    try {
      for (let current = first; !current.done; current = await iterator.next()) {
        const stat = object(current.value);
        if (!isJsonArray(stat.timeline)) throw new GatekeeperError("RIPEstat routing row omitted its timeline", "invalid-response");
        const registrationDate = sourceTime(stat.stats_date);
        for (const interval of stat.timeline) {
          const period = object(interval);
          const start = sourceTime(period.starttime);
          const end = sourceTime(period.endtime);
          if (end < start || start < from || end > before || Date.parse(start) % DAY_MS !== 0)
            throw new GatekeeperError("RIPEstat timeline is invalid or outside its requested scope", "invalid-response");
          for (let time = Date.parse(start); time <= Date.parse(end) && time < Date.parse(before); time += DAY_MS) {
            for (const measure of ROUTING_MEASURES) {
              const value = stat[measure.field];
              if (value === -1) continue; // Unavailable count sentinel; never a negative prefix/ASN count.
              // A RIS count is the day's mean of RIS's samples, so it is a half on a day it changed (803.5 prefixes on 2025-02-01).
              const measured = count(value, measure.source !== "RIS");
              const stamp = measure.source === "RIR statistics" ? registrationDate : new Date(time).toISOString();
              if (stamp < from || stamp >= before) continue;
              const key = `${measure.field}|${stamp}`;
              if (seen.has(key)) {
                if (seen.get(key) !== measured) throw new GatekeeperError("RIPEstat returned conflicting daily counts", "invalid-response");
                continue;
              }
              if (seen.size >= 360) throw new GatekeeperError("RIPEstat routing output exceeds its daily window", "response-too-large");
              seen.set(key, measured);
              accepted += 1;
              if (!watermark || stamp > watermark) watermark = stamp;
              const dimensions: SeriesPoint["dimensions"] = { measure: measure.measure, source: measure.source };
              if (measure.ipVersion) dimensions.ipVersion = measure.ipVersion;
              yield { productKey: "routing", point: { seriesKey: measure.field, eventTime: stamp, value: measured, unit: measure.unit, dimensions } };
            }
          }
        }
      }
      const root = stream.envelope();
      const complete = envelope(root, "country-routing-stats");
      validateCountry(complete);
      if (complete.resolution !== "1d") throw new GatekeeperError("RIPEstat did not honor daily resolution", "invalid-response");
      const earliest = sourceTime(complete.earliest_time);
      const latest = sourceTime(complete.latest_time);
      if (earliest > latest) throw new GatekeeperError("RIPEstat availability boundaries are reversed", "invalid-response");
      partial = hasWarnings(root);
      finished = true;
    } finally {
      await iterator.return?.();
    }
  }
  return {
    products: [declaration(context, "routing", "series", SERIES_SCHEMA, "time-series", "source-window")],
    rows: rows(),
    finish: () => {
      if (!finished) throw new GatekeeperError("RIPEstat routing stream is incomplete", "invalid-response");
      const finalization: ProductFinalization = { productKey: "routing", completeness: partial ? "partial" : "complete" };
      if (watermark) finalization.watermark = watermark;
      return { quality: { acceptedRecords: accepted, rejectedRecords: 0 }, products: [finalization] };
    },
  };
}

function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new GatekeeperError("RIPEstat omitted a required object", "invalid-response");
  return value;
}

function count(value: JsonValue | undefined, integer = true): number {
  if (!isJsonNumber(value) || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value)))
    throw new GatekeeperError("RIPEstat returned an invalid count", "invalid-response");
  return value;
}

function resourceText(kind: string, value: JsonValue): string {
  if (kind === "asn") {
    try {
      return `AS${asn(value)}`;
    } catch {
      throw new GatekeeperError("RIPEstat returned an invalid AS resource", "invalid-response");
    }
  }
  if (!isJsonString(value) || value.length > 100) throw new GatekeeperError("RIPEstat returned an invalid IP resource", "invalid-response");
  if (kind === "ipv4") {
    const prefix = /^([\d.]+)\/(\d{1,2})$/.exec(value);
    if (prefix?.[1] && prefix[2] && Number(prefix[2]) <= 32) return `${ipv4(prefix[1])}/${Number(prefix[2])}`;
    const range = value.split("-");
    if (range.length === 2 && range[0] && range[1]) {
      const start = ipv4(range[0]);
      const end = ipv4(range[1]);
      const number = (address: string) => address.split(".").reduce((result, part) => result * 256 + Number(part), 0);
      if (number(start) <= number(end)) return `${start}-${end}`;
    }
  } else {
    const prefix = /^([0-9a-f:]+)\/(\d{1,3})$/i.exec(value);
    if (prefix?.[1] && prefix[2] && Number(prefix[2]) <= 128) {
      try {
        return `${new URL(`https://[${prefix[1]}]/`).hostname.slice(1, -1)}/${Number(prefix[2])}`;
      } catch {
        /* Invalid IPv6 literals do not enter the reference inventory. */
      }
    }
  }
  throw new GatekeeperError("RIPEstat returned an invalid IP resource", "invalid-response");
}

function ipv4(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255))
    throw new GatekeeperError("RIPEstat returned an invalid IPv4 address", "invalid-response");
  return parts.map(Number).join(".");
}
