import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  streamJsonArray,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { pageEnvelope, RIPEATLAS_MAX_PAGE_BYTES, RIPEATLAS_MAX_RECORDS, validateRipeatlasFeedConfig } from "./ripeatlas";

/** The probe states this platform inventories, named from the status ID rather than the free-text label. */
const PROBE_STATUSES = new Map<number, string>([
  [0, "never-connected"],
  [1, "connected"],
  [2, "disconnected"],
]);

const PROBE_SCHEMA = {
  fields: [
    field("id", "identifier", false),
    field("countryCode", "category", false),
    field("asnV4", "identifier", true),
    field("asnV6", "identifier", true),
    field("prefixV4", "string", true),
    field("prefixV6", "string", true),
    field("isAnchor", "boolean", false),
    field("status", "category", false),
    field("statusSince", "datetime", true),
    field("firstConnected", "datetime", true),
    field("tags", "json", false),
  ],
};

const COUNT_SCHEMA = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

const ANCHOR_SCHEMA = {
  fields: [
    field("id", "identifier", false),
    field("hostname", "string", false),
    field("fqdn", "url", false),
    field("probeId", "identifier", true),
    field("countryCode", "category", false),
    field("city", "string", true),
    field("asnV4", "identifier", true),
    field("asnV6", "identifier", true),
    field("isIpv4Only", "boolean", true),
    field("isDisabled", "boolean", true),
    field("isReplacement", "boolean", true),
    field("replacesAnchorId", "identifier", true),
    field("hardwareVersion", "identifier", true),
    field("dateLive", "datetime", true),
    field("dateDecommissioned", "datetime", true),
  ],
};

export class RipeatlasTransformer {
  readonly id = "ripeatlas-json";
  readonly version = "1";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const config = validateRipeatlasFeedConfig(context.feed.config);
    return config.feed === "country-anchors" ? anchors(body, context) : probes(body, context);
  }
}

/** The pages the source adapter concatenated, read one page at a time. */
function pageReader(body: ReadableStream<Uint8Array>) {
  const pages = streamJsonArray(body, ["pages"], { maxElementBytes: RIPEATLAS_MAX_PAGE_BYTES, maxEnvelopeBytes: 1024 });
  return pages.elements[Symbol.asyncIterator]();
}

function declaration(
  productKey: string,
  slug: string,
  title: string,
  description: string,
  kind: ProductDeclaration["kind"],
  role: ProductDeclaration["role"],
  schema: ProductDeclaration["schema"],
  updateMode: ProductDeclaration["updateMode"],
): ProductDeclaration {
  return { productKey, slug, title, description, kind, role, schema, updateMode, completeness: "complete" };
}

async function probes(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  const iterator = pageReader(body);
  const first = await iterator.next();
  if (first.done) throw new GatekeeperError("RIPE Atlas collection omitted its pages", "invalid-response");
  const base = context.feed.slug.replace(/-feed$/, "");
  const counts = new Map<string, number>([...PROBE_STATUSES.values()].map((status) => [status, 0]));
  const seen = new Set<number>();
  let pages = 0;
  let total = 0;
  let watermark: string | undefined;
  let finished = false;
  async function* rows(): AsyncGenerator<NormalizedRow> {
    try {
      for (let current = first; !current.done; current = await iterator.next()) {
        const page = pageEnvelope(current.value);
        pages += 1;
        total = page.count;
        for (const raw of page.results) {
          const id = identifier(raw.id, "probe");
          if (raw.country_code !== "PT") throw new GatekeeperError("RIPE Atlas returned a probe outside Portugal", "invalid-response");
          // A host who asked not to be indexed stays unpublished even if the filter was ignored upstream.
          if (raw.is_public !== true) throw new GatekeeperError("RIPE Atlas returned a non-public probe", "invalid-response");
          if (seen.has(id)) throw new GatekeeperError("RIPE Atlas pagination repeated a probe ID", "invalid-response");
          if (seen.size >= RIPEATLAS_MAX_RECORDS) throw new GatekeeperError("RIPE Atlas exceeded its probe bound", "response-too-large");
          seen.add(id);
          const state = object(raw.status);
          const status = PROBE_STATUSES.get(identifier(state.id, "probe status", true));
          if (!status) throw new GatekeeperError("RIPE Atlas returned a probe outside the inventoried states", "invalid-response");
          counts.set(status, (counts.get(status) ?? 0) + 1);
          const since = timestamp(state.since);
          const payload: JsonObject = {
            id: String(id),
            countryCode: "PT",
            asnV4: asn(raw.asn_v4),
            asnV6: asn(raw.asn_v6),
            prefixV4: prefix(raw.prefix_v4),
            prefixV6: prefix(raw.prefix_v6),
            isAnchor: boolean(raw.is_anchor) ?? false,
            status,
            statusSince: since,
            firstConnected: unixTime(raw.first_connected),
            tags: tags(raw.tags),
          };
          if (since && (!watermark || since > watermark)) watermark = since;
          yield { productKey: "probes", record: since ? { entityKey: String(id), eventTime: since, payload } : { entityKey: String(id), payload } };
        }
      }
      // A count of the probes standing now, which the inventory itself does not record over time.
      for (const [status, value] of counts)
        yield { productKey: "probe-counts", point: { seriesKey: `probes-${status}`, eventTime: context.observedAt, value, unit: "probes", dimensions: { status } } };
      yield {
        productKey: "probe-counts",
        point: { seriesKey: "probes-all", eventTime: context.observedAt, value: seen.size, unit: "probes", dimensions: { status: "any" } },
      };
      finished = true;
    } finally {
      await iterator.return?.();
    }
  }
  const inventory = declaration("probes", base, context.feed.title, context.feed.description, "record", "current-state", PROBE_SCHEMA, "authoritative-snapshot");
  const series = declaration(
    "probe-counts",
    `${base}-count-series`,
    "Portuguese RIPE Atlas probes over time",
    "How many public RIPE Atlas probes registered in Portugal were connected, disconnected or never connected, counted once per collection.",
    "series",
    "time-series",
    COUNT_SCHEMA,
    "delta",
  );
  return {
    products: [inventory, series],
    rows: rows(),
    finish: () => {
      if (!finished) throw new GatekeeperError("RIPE Atlas probe stream is incomplete", "invalid-response");
      // Page pagination is not a snapshot: a probe added between two pages can shift an
      // existing one past a page boundary, so only a single complete page may retract.
      const complete = pages === 1 && seen.size === total;
      const finalization: ProductFinalization = { productKey: "probes", completeness: complete ? "complete" : "partial" };
      if (watermark) finalization.watermark = watermark;
      return {
        quality: { acceptedRecords: seen.size, rejectedRecords: 0 },
        products: [finalization, { productKey: "probe-counts", completeness: complete ? "complete" : "partial", watermark: context.observedAt }],
      };
    },
  };
}

async function anchors(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
  const iterator = pageReader(body);
  const first = await iterator.next();
  if (first.done) throw new GatekeeperError("RIPE Atlas collection omitted its pages", "invalid-response");
  const seen = new Set<number>();
  let pages = 0;
  let total = 0;
  let watermark: string | undefined;
  let finished = false;
  async function* rows(): AsyncGenerator<NormalizedRow> {
    try {
      for (let current = first; !current.done; current = await iterator.next()) {
        const page = pageEnvelope(current.value);
        pages += 1;
        total = page.count;
        for (const raw of page.results) {
          const id = identifier(raw.id, "anchor");
          if (raw.country !== "PT") throw new GatekeeperError("RIPE Atlas returned an anchor outside Portugal", "invalid-response");
          if (seen.has(id)) throw new GatekeeperError("RIPE Atlas pagination repeated an anchor ID", "invalid-response");
          if (seen.size >= RIPEATLAS_MAX_RECORDS) throw new GatekeeperError("RIPE Atlas exceeded its anchor bound", "response-too-large");
          seen.add(id);
          const live = timestamp(raw.date_live);
          // `company`, `nic_handle`, `geometry` and every address field of the anchor are
          // read past deliberately: the hostname RIPE publishes in DNS is identity enough.
          const payload: JsonObject = {
            id: String(id),
            hostname: text(raw.hostname, false),
            fqdn: text(raw.fqdn, false),
            probeId: raw.probe === null || raw.probe === undefined ? null : String(identifier(raw.probe, "anchor probe")),
            countryCode: "PT",
            city: text(raw.city),
            asnV4: asn(raw.as_v4),
            asnV6: asn(raw.as_v6),
            isIpv4Only: boolean(raw.is_ipv4_only),
            isDisabled: boolean(raw.is_disabled),
            isReplacement: boolean(raw.is_replacement),
            replacesAnchorId: raw.replaces_anchor === null || raw.replaces_anchor === undefined ? null : String(identifier(raw.replaces_anchor, "replaced anchor")),
            hardwareVersion: raw.hardware_version === null || raw.hardware_version === undefined ? null : String(identifier(raw.hardware_version, "anchor hardware version", true)),
            dateLive: live,
            dateDecommissioned: timestamp(raw.date_decommissioned),
          };
          if (live && (!watermark || live > watermark)) watermark = live;
          yield { productKey: "anchors", record: live ? { entityKey: String(id), eventTime: live, payload } : { entityKey: String(id), payload } };
        }
      }
      finished = true;
    } finally {
      await iterator.return?.();
    }
  }
  return {
    products: [
      declaration("anchors", context.feed.slug.replace(/-feed$/, ""), context.feed.title, context.feed.description, "record", "reference", ANCHOR_SCHEMA, "authoritative-snapshot"),
    ],
    rows: rows(),
    finish: () => {
      if (!finished) throw new GatekeeperError("RIPE Atlas anchor stream is incomplete", "invalid-response");
      const finalization: ProductFinalization = { productKey: "anchors", completeness: pages === 1 && seen.size === total ? "complete" : "partial" };
      if (watermark) finalization.watermark = watermark;
      return { quality: { acceptedRecords: seen.size, rejectedRecords: 0 }, products: [finalization] };
    },
  };
}

function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new GatekeeperError("RIPE Atlas omitted a required object", "invalid-response");
  return value;
}

function identifier(value: JsonValue | undefined, what: string, allowZero = false): number {
  if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new GatekeeperError(`RIPE Atlas ${what} identity is invalid`, "invalid-response");
  return value;
}

function asn(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value < 1 || value > 4_294_967_295)
    throw new GatekeeperError("RIPE Atlas returned an invalid AS number", "invalid-response");
  return `AS${value}`;
}

function prefix(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isJsonString(value) || !/^[\da-f.:]{2,45}\/\d{1,3}$/i.test(value) || Number(value.split("/")[1]) > 128)
    throw new GatekeeperError("RIPE Atlas returned an invalid prefix", "invalid-response");
  return value;
}

function boolean(value: JsonValue | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  if (!isJsonBoolean(value)) throw new GatekeeperError("RIPE Atlas returned an invalid flag", "invalid-response");
  return value;
}

function text(value: JsonValue | undefined, nullable = true): string | null {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  if (!isJsonString(value) || !value.trim() || value.length > 255) throw new GatekeeperError("RIPE Atlas text is invalid", "invalid-response");
  return value.trim();
}

/**
 * Host-chosen tags describe the connection, and are worth publishing. The
 * `system-*` tags are RIPE's own operational flags, which flip with a probe's
 * DNS behaviour from hour to hour and would rewrite the whole inventory.
 */
function tags(value: JsonValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (!isJsonArray(value) || value.length > 100) throw new GatekeeperError("RIPE Atlas returned invalid probe tags", "invalid-response");
  const slugs = new Set<string>();
  for (const entry of value) {
    const slug = text(object(entry).slug, false);
    if (!slug || slug.startsWith("system-")) continue;
    // Atlas slugifies a tag name into lowercase words; anything else is not a tag slug.
    if (!/^[a-z\d][a-z\d_-]{0,63}$/.test(slug)) throw new GatekeeperError("RIPE Atlas returned an invalid probe tag", "invalid-response");
    slugs.add(slug);
  }
  return [...slugs].toSorted();
}

/** RIPE Atlas serves UTC, sometimes without saying so; a naive stamp is read as UTC. */
function timestamp(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))
    throw new GatekeeperError("RIPE Atlas source timestamp is invalid", "invalid-response");
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10))
    throw new GatekeeperError("RIPE Atlas source calendar date is invalid", "invalid-response");
  const parsed = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(parsed.getTime())) throw new GatekeeperError("RIPE Atlas source timestamp is invalid", "invalid-response");
  return parsed.toISOString();
}

function unixTime(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value < 0 || value > 4_102_444_800)
    throw new GatekeeperError("RIPE Atlas returned an invalid connection time", "invalid-response");
  return new Date(value * 1000).toISOString();
}
