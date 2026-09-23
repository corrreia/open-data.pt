import {
  GatekeeperError,
  contentEtag,
  field,
  fixedOrigin,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  lisbonDay,
  readBoundedJson,
  retryAfterSeconds,
  streamNdjson,
  type FeedKindDescription,
  type JsonValue,
  type NormalizedRow,
  type ProductFinalization,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
  type StreamingTransform,
  type TransformContext,
} from "#/index";

export const REN_PERIODIC_ORIGIN = "https://servicebus.ren.pt";
const MAX_SOURCE_BYTES = 512 * 1024;
const DAILY_NO_DATA = "No data available for the selected date.";

export type RenPeriodicService = "installed-capacity" | "lng-terminal-balance" | "gas-storage";

export const REN_PERIODIC_FEEDS = {
  "installed-capacity": {
    kind: "installed-capacity",
    title: "Installed electricity capacity",
    description: "Installed generating capacity by technology for the latest three completed months available from REN.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
  "lng-terminal-balance": {
    kind: "lng-terminal-balance",
    title: "LNG terminal daily balance",
    description: "Daily total inputs, outputs, stored energy and fullness of Portugal's LNG terminal in the latest seven-day reporting window.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
  "gas-storage": {
    kind: "gas-storage",
    title: "Underground natural gas storage",
    description: "Daily total injections, withdrawals, stored energy and fullness in the latest seven-day reporting window.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export interface RenPeriodicOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
  now?: () => Date;
}

export function isRenPeriodicService(value: string | undefined): value is RenPeriodicService {
  return value === "installed-capacity" || value === "lng-terminal-balance" || value === "gas-storage";
}

export function validateRenPeriodicConfig(config: SourceConfig): SourceConfig {
  const service = config.service ?? config.feed;
  if (!isRenPeriodicService(service)) throw new GatekeeperError("Unsupported REN periodic service", "invalid-config");
  if (config.service && config.feed && config.service !== config.feed) throw new GatekeeperError("REN feed and service must match", "invalid-config");
  for (const key of Object.keys(config)) {
    if (key !== "service" && key !== "feed" && key !== "day") throw new GatekeeperError(`REN periodic configuration does not accept ${key}`, "source-denied");
  }
  const result: SourceConfig = { service, feed: service };
  if (config.day !== undefined) {
    const day = config.day;
    if (!validDay(day)) throw new GatekeeperError("REN day must be a valid YYYY-MM-DD date", "invalid-config");
    // All pins within a reporting month address the identical upstream resource.
    result.day = service === "installed-capacity" ? `${day.slice(0, 7)}-01` : day;
  }
  return result;
}

/** The normalizer a periodic feed's collection is stamped with. Dated endpoints exist, but their history boundary and exhaustion are not documented, so no periodic feed walks back. */
export const REN_PERIODIC_NORMALIZER = { id: "ren-periodic-data", version: "1" };

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const stamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day;
}

function periods(service: RenPeriodicService, now: Date, pinned: string | undefined): string[] {
  if (pinned) return [service === "installed-capacity" ? `${pinned.slice(0, 7)}-01` : pinned];
  const today = lisbonDay(now);
  const date = new Date(`${today}T00:00:00Z`);
  if (service === "installed-capacity") {
    return Array.from({ length: 3 }, (_, index) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - index - 1, 1)).toISOString().slice(0, 10));
  }
  return Array.from({ length: 7 }, (_, index) => new Date(date.getTime() - (index + 1) * 86_400_000).toISOString().slice(0, 10));
}

function endpoint(origin: string, service: RenPeriodicService, period: string): URL {
  const path =
    service === "installed-capacity"
      ? "electricity/ElectricityInstalledPowerMonthly"
      : service === "gas-storage"
        ? "gas/GasUndergroundStorageBalanceDaily"
        : "gas/GasLNGTerminalBalanceDaily";
  const url = new URL(`/datahubapi/${path}`, origin);
  url.searchParams.set("culture", "en-US");
  if (service === "installed-capacity") {
    url.searchParams.set("year", period.slice(0, 4));
    url.searchParams.set("month", period.slice(5, 7));
  } else url.searchParams.set("date", period);
  return url;
}

export async function collectRenPeriodic(options: RenPeriodicOptions, checkpoint: SourceValidator | undefined, signal?: AbortSignal): Promise<SourceFetch> {
  const config = validateRenPeriodicConfig(options.config);
  const service = config.service;
  if (!isRenPeriodicService(service)) throw new GatekeeperError("Invalid REN periodic service", "invalid-config");
  const origin = fixedOrigin(options.apiOrigin, REN_PERIODIC_ORIGIN);
  const selected = periods(service, options.now?.() ?? new Date(), config.day);
  const lines: string[] = [];
  let sourceUrl = "";
  let missing = false;
  const init: RequestInit = { redirect: "manual", headers: { Accept: "application/json" } };
  if (signal) init.signal = signal;
  // Every component is fetched: a validator for one day cannot validate the window.
  for (const period of selected) {
    const url = endpoint(origin, service, period);
    const response = await options.fetcher(url, init);
    if ((!response.ok && response.status !== 404) || !response.body)
      throw new GatekeeperError(`REN periodic API returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
    const data = await readBoundedJson(response, 32 * 1024, "REN periodic response");
    // REN uses 404 plus this exact JSON message for a day not yet published.
    if (isJsonObject(data) && data.message === DAILY_NO_DATA) {
      missing = true;
      continue;
    }
    if (!response.ok) throw new GatekeeperError(`REN periodic API returned HTTP ${response.status}`, "upstream-error");
    if (!sourceUrl) sourceUrl = url.toString();
    lines.push(JSON.stringify({ period, response: data }));
  }
  if (lines.length === 0) throw new GatekeeperError("REN has not published any requested reporting period", "upstream-error", 21_600);
  const body = new TextEncoder().encode(`${lines.join("\n")}\n`);
  if (body.byteLength > MAX_SOURCE_BYTES) throw new GatekeeperError("REN periodic document exceeds source budget", "response-too-large");
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return { kind: "body", body, validator, completeness: missing ? "partial" : "complete", provenance: { sourceUrl } };
}

interface PeriodMeasure {
  key: string;
  value: number;
  unit: string;
}

function measures(response: JsonValue, service: string): PeriodMeasure[] {
  if (service === "installed-capacity") {
    if (!Array.isArray(response)) throw new GatekeeperError("REN installed capacity must be an array", "invalid-response");
    const result: PeriodMeasure[] = [];
    const keys = new Set<string>();
    for (const item of response) {
      if (!isJsonObject(item) || !isJsonString(item.type) || !item.type.trim()) throw new GatekeeperError("REN installed capacity has invalid technology", "invalid-response");
      if (keys.has(item.type)) throw new GatekeeperError("REN installed capacity repeats a technology", "invalid-response");
      keys.add(item.type);
      if (item.monthly_Accumulation === null) continue;
      if (!isJsonNumber(item.monthly_Accumulation) || !Number.isFinite(item.monthly_Accumulation))
        throw new GatekeeperError("REN installed capacity value is invalid", "invalid-response");
      result.push({ key: item.type, value: item.monthly_Accumulation, unit: "MW" });
    }
    return result;
  }
  if (
    !isJsonObject(response) ||
    !isJsonObject(response.Storage) ||
    !isJsonObject(response.Storage.data) ||
    !isJsonObject(response.Inputs) ||
    !isJsonObject(response.Outputs) ||
    !Array.isArray(response.Storage.additionalDetails)
  ) {
    throw new GatekeeperError("REN gas balance structure is invalid", "invalid-response");
  }
  const result = [
    measure("stored-energy", response.Storage.data.daily_Accumulation, "GWh"),
    measure("total-inputs", response.Inputs.total, "GWh"),
    measure("total-outputs", response.Outputs.total, "GWh"),
  ];
  const percentage = response.Storage.additionalDetails.find((item) => isJsonObject(item) && isJsonString(item.type) && item.type.toLowerCase() === "percentage");
  if (!isJsonObject(percentage)) throw new GatekeeperError("REN gas storage percentage is missing", "invalid-response");
  result.push(measure("storage-fullness", percentage.daily_Accumulation, "%"));
  return result;
}

function measure(key: string, value: JsonValue | undefined, unit: string): PeriodMeasure {
  if (!isJsonNumber(value) || !Number.isFinite(value)) throw new GatekeeperError(`REN ${key} is not numeric`, "invalid-response");
  return { key, value, unit };
}

/** The periodic NDJSON document, one line per reporting period, into one series per measure. */
export function transformRenPeriodic(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
  let accepted = 0;
  let watermark: string | undefined;
  const service = context.feed.config.service;
  const seen = new Set<string>();
  async function* rows(): AsyncGenerator<NormalizedRow> {
    for await (const line of streamNdjson(body, { maxElementBytes: 64 * 1024 })) {
      if (!isJsonObject(line) || !isJsonString(line.period) || !validDay(line.period) || line.response === undefined) {
        throw new GatekeeperError("REN reporting period document is invalid", "invalid-response");
      }
      if (seen.has(line.period)) throw new GatekeeperError("REN reporting period repeats", "invalid-response");
      seen.add(line.period);
      const eventTime = `${line.period}T00:00:00.000Z`;
      for (const item of measures(line.response, service ?? "")) {
        accepted += 1;
        if (!watermark || eventTime > watermark) watermark = eventTime;
        yield {
          productKey: "periodic",
          point: {
            seriesKey: item.key,
            eventTime,
            value: item.value,
            unit: item.unit,
            dimensions: { measure: item.key, reportingPeriod: service === "installed-capacity" ? "month" : "day" },
          },
        };
      }
    }
    if (accepted === 0) throw new GatekeeperError("REN response contained no observations", "invalid-response");
  }
  return {
    products: [
      {
        productKey: "periodic",
        slug: context.feed.slug.replace(/-feed$/, ""),
        title: context.feed.title,
        description: context.feed.description,
        kind: "series",
        role: "time-series",
        updateMode: "source-window",
        completeness: "complete",
        schema: {
          fields: [
            field("seriesKey", "identifier", false),
            field("eventTime", "datetime", false),
            field("value", "number", false),
            field("unit", "category", false),
            field("dimensions", "json", false),
          ],
        },
      },
    ],
    rows: rows(),
    finish: () => {
      const product: ProductFinalization = { productKey: "periodic" };
      if (watermark) product.watermark = watermark;
      return { quality: { acceptedRecords: accepted, rejectedRecords: 0 }, products: [product] };
    },
  };
}
