import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  lisbonDay,
  lisbonInstants,
  lisbonOffsetMinutes,
  parseJsonBytes,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  type FeedKindDescription,
  type HistoryCursor,
  type JsonObject,
  type JsonValue,
  type SourceExhausted,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
  type SourceConfig,
} from "../../../index";
import { REN_PERIODIC_FEEDS, REN_PERIODIC_ORIGIN, collectRenPeriodic, isRenPeriodicService, validateRenPeriodicConfig } from "./periodic";

export const REN_ORIGIN = "https://datahub.ren.pt";
/** The data hub answers only POSTs, so the source link a person can open is its own site. */
export const REN_DATAHUB_URL = "https://datahub.ren.pt/";
export const REN_MAX_BYTES = 2 * 1024 * 1024;
/**
 * REN accepts one `dayToSearchString` per request. A civil-day slice is only
 * about 3–25 KiB and at most roughly 1,200 source points in observed charts,
 * comfortably below the feed policy's 2 MiB cap even on 25-hour DST days.
 */
export const REN_HISTORY_SLICE_SECONDS = 24 * 60 * 60;
const DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;

export interface RenServiceDefinition {
  path: string;
  title: string;
  description: string;
  intervalMinutes: 15 | 60;
  unit: "MW" | "MWh";
  selectedSeries?: readonly string[];
  gasDayStartHour?: number;
  earliest: string;
}

export type RenServiceName = "production-breakdown" | "consumption" | "renewables-share" | "interconnection-exchanges" | "gas-consumption" | "gas-network-balance";

/** Every REN service this Gatekeeper knows, keyed by the feed kind it offers. */
type RenServiceCatalogue = { [Service in RenServiceName]: RenServiceDefinition };

export const REN_SERVICES: RenServiceCatalogue = {
  "production-breakdown": {
    path: "/service/Electricity/ProductionBreakdown/1354",
    title: "Electricity production breakdown",
    description: "Quarter-hour electricity consumption, storage, generation, and import balance by source.",
    intervalMinutes: 15,
    unit: "MW",
    earliest: "2010-01-01T00:00:00.000Z",
  },
  consumption: {
    path: "/service/Electricity/ProductionBreakdown/1354",
    title: "Electricity consumption",
    description: "Quarter-hour electricity consumption in mainland Portugal.",
    intervalMinutes: 15,
    unit: "MW",
    selectedSeries: ["Consumption"],
    earliest: "2010-01-01T00:00:00.000Z",
  },
  "renewables-share": {
    path: "/service/Electricity/ProductionBreakdown/1355",
    title: "Renewable and non-renewable electricity",
    description: "Quarter-hour consumption, renewable generation, non-renewable generation, and import balance.",
    intervalMinutes: 15,
    unit: "MW",
    earliest: "2010-01-01T00:00:00.000Z",
  },
  "interconnection-exchanges": {
    path: "/service/Electricity/ImportBalance/1395",
    title: "Electricity interconnection exchanges",
    description: "Quarter-hour electricity imports and exports across Portugal's interconnections.",
    intervalMinutes: 15,
    unit: "MW",
    earliest: "2010-01-01T00:00:00.000Z",
  },
  "gas-consumption": {
    path: "/service/Gas/ConsumptionDeaggregation/2849",
    title: "Natural gas consumption",
    description: "Hourly natural gas consumption by electricity market, high-pressure clients, distribution, and autonomous units.",
    intervalMinutes: 60,
    unit: "MW",
    gasDayStartHour: 5,
    earliest: "2014-01-01T00:00:00.000Z",
  },
  "gas-network-balance": {
    path: "/service/Gas/RNTGNTotal/2864",
    title: "Natural gas network balance",
    description: "Hourly inputs and outputs for Portugal's high-pressure natural gas network.",
    intervalMinutes: 60,
    unit: "MWh",
    gasDayStartHour: 5,
    earliest: "2014-01-01T00:00:00.000Z",
  },
};

/** The feed kind each REN service declares. */
type RenFeedCatalogue = { [Service in RenServiceName]: FeedKindDescription };

const REN_CHART_FEEDS: RenFeedCatalogue =
  // SAFETY: the entries are built from REN_SERVICES, so the result carries one
  // feed kind for every service name and no others.
  Object.fromEntries(
    Object.entries(REN_SERVICES).map(([kind, definition]) => [
      kind,
      {
        kind,
        title: definition.title,
        description: definition.description,
        semantics: {
          domainSubject: "observation",
          defaultProductRole: "time-series",
        },
        history: {
          earliest: definition.earliest,
        },
      } satisfies FeedKindDescription,
    ]),
  ) as RenFeedCatalogue;

export const REN_FEEDS = { ...REN_CHART_FEEDS, ...REN_PERIODIC_FEEDS };

export interface RenCollectionDocument {
  service: RenServiceName;
  days: Array<{ day: string; response: JsonObject }>;
}

export function validateRenFeedConfig(config: SourceConfig): SourceConfig {
  if (isRenPeriodicService(config.service ?? config.feed)) return validateRenPeriodicConfig(config);
  if (Object.hasOwn(config, "host") || Object.hasOwn(config, "url")) {
    throw new GatekeeperError("REN feed hosts and URLs are fixed by the Gatekeeper", "source-denied");
  }
  const unexpected = Object.keys(config).filter((key) => key !== "service" && key !== "day" && key !== "feed");
  if (unexpected.length > 0) {
    throw new GatekeeperError(`Unsupported REN configuration field: ${unexpected[0]}`, "invalid-config");
  }
  // The kernel names a feed kind with `feed`; `service` is the same value.
  const service = config.service ?? config.feed;
  if (config.feed !== undefined && config.service !== undefined && config.feed !== config.service) {
    throw new GatekeeperError("REN feed and service must name the same service", "invalid-config");
  }
  if (!isRenServiceName(service)) {
    throw new GatekeeperError(`REN feeds require service=${Object.keys(REN_SERVICES).join(", ")}`, "invalid-config");
  }
  if (config.day !== undefined && !isCalendarDay(config.day)) {
    throw new GatekeeperError("REN day must be a valid date in YYYY-MM-DD form", "invalid-config");
  }
  return config.day === undefined ? { feed: service, service } : { feed: service, service, day: config.day };
}

export async function collectRenFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
  now: Date = new Date(),
): Promise<SourceFetch> {
  const validated = validateRenFeedConfig(config);
  if (isRenPeriodicService(validated.service)) {
    return collectRenPeriodic({ config: validated, apiOrigin: REN_PERIODIC_ORIGIN, fetcher, now: () => now }, checkpoint);
  }
  // SAFETY: `validateRenFeedConfig` has just confirmed `service` names one of
  // the services REN_SERVICES declares.
  const service = validated.service as RenServiceName;
  const definition = REN_SERVICES[service];
  const origin = fixedOrigin(apiOrigin, REN_ORIGIN);
  const days = validated.day === undefined ? defaultCollectionDays(now) : [validated.day];
  const requestHeaders = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  if (checkpoint?.etag) requestHeaders.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    requestHeaders.set("If-Modified-Since", checkpoint.lastModified);
  }

  const collected: RenCollectionDocument["days"] = [];
  let sourceBytes = 0;
  let lastModified: string | undefined;
  for (const day of days) {
    const endpoint = endpointFor(origin, definition.path, day);
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: "{}",
    });
    if (response.status === 304) return notModified(response, checkpoint);
    const remaining = REN_MAX_BYTES - sourceBytes;
    if (remaining <= 0) responseTooLarge();
    // A day REN has not published yet answers 400 (or 204) with its "no data for the selected date" notice. That is an
    // empty day, not a failure: the gas charts only appear hours into the gas day, and asking for today before then is
    // how the request was meant to be answered.
    if (response.status === 204) {
      collected.push({ day, response: renNoDataDocument() });
      continue;
    }
    // A provider failure is never read: only REN's own JSON notice can turn a rejected request into an empty day.
    if (!response.body || (!response.ok && !(response.headers.get("content-type") ?? "").includes("json"))) throw upstreamError(service, response);
    const bytes = await readBoundedResponse(response, remaining, `REN Data Hub ${service} response`);
    sourceBytes += bytes.byteLength;
    let value: JsonValue;
    try {
      value = parseJsonBytes(bytes);
    } catch {
      if (!response.ok) throw upstreamError(service, response);
      throw new GatekeeperError(`REN Data Hub returned invalid JSON for ${service}`, "invalid-response");
    }
    if (isJsonObject(value) && isRenNoDataResponse(value)) {
      collected.push({ day, response: value });
      continue;
    }
    if (!response.ok) throw upstreamError(service, response);
    if (!isChartResponse(value)) {
      throw new GatekeeperError(`REN Data Hub returned an unsupported chart for ${service}`, "invalid-response");
    }
    collected.push({ day, response: value });
    const upstreamModified = response.headers.get("last-modified");
    if (upstreamModified) lastModified = upstreamModified;
  }

  const document: RenCollectionDocument = { service, days: collected };
  const body = new TextEncoder().encode(JSON.stringify(document));
  if (body.byteLength > REN_MAX_BYTES) responseTooLarge();
  const primaryDay = days[0];
  if (primaryDay === undefined) {
    throw new GatekeeperError("REN collection selected no days", "invalid-config");
  }
  // The document's content hash is the validator: an identical chart set is
  // unchanged whatever the transport says.
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (lastModified) validator.lastModified = lastModified;
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return {
    kind: "body",
    body,
    provenance: { sourceUrl: REN_DATAHUB_URL },
    completeness: collectionIsComplete(document, definition, now) ? "complete" : "partial",
    validator,
  };
}

/** Collect exactly one Europe/Lisbon civil day strictly before the cursor. */
export async function collectRenHistory(config: SourceConfig, cursor: HistoryCursor, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateRenFeedConfig(config);
  // SAFETY: `validateRenFeedConfig` has just confirmed `service` names one of
  // the services REN_SERVICES declares.
  const service = validated.service as RenServiceName;
  const definition = REN_SERVICES[service];
  const origin = fixedOrigin(apiOrigin, REN_ORIGIN);
  const before = historyBefore(cursor.before);
  const beforeDay = lisbonDay(before);
  const day = addDays(beforeDay, -1);
  const from = dayStart(day).toISOString();
  const endpoint = endpointFor(origin, definition.path, day);

  if (day < definition.earliest.slice(0, 10)) {
    return exhaustedHistory();
  }

  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (response.status === 429 || response.status >= 500) {
    throw historyUpstreamError(service, response);
  }

  let value: JsonObject;
  if (response.status === 204) {
    value = renNoDataDocument();
  } else {
    const bytes = await readBoundedResponse(response, REN_MAX_BYTES, `REN Data Hub ${service} history response`);
    let parsed: JsonValue;
    try {
      parsed = parseJsonBytes(bytes);
    } catch {
      throw new GatekeeperError(`REN Data Hub returned invalid JSON for ${service}`, "invalid-response");
    }
    if (!isJsonObject(parsed)) {
      throw new GatekeeperError(`REN Data Hub returned an unsupported history response for ${service}`, "invalid-response");
    }
    value = parsed;
  }

  const noData = isRenNoDataResponse(value) || (isChartResponse(value) && !chartHasSeriesData(value, definition));
  if (!response.ok && !noData) {
    throw historyUpstreamError(service, response);
  }
  if (!noData && !isChartResponse(value)) {
    throw new GatekeeperError(`REN Data Hub returned an unsupported chart for ${service}`, "invalid-response");
  }
  if (noData && cursor.token === emptyDayToken(addDays(day, 1))) {
    return exhaustedHistory();
  }

  const document: RenCollectionDocument = {
    service,
    days: [{ day, response: value }],
  };
  const body = new TextEncoder().encode(JSON.stringify(document));
  if (body.byteLength > REN_MAX_BYTES) responseTooLarge();
  const next: HistoryCursor = { before: from };
  if (noData) next.token = emptyDayToken(day);
  return {
    kind: "body",
    body,
    provenance: { sourceUrl: REN_DATAHUB_URL },
    completeness: noData || collectionIsComplete(document, definition, new Date()) ? "complete" : "partial",
    next,
  };
}

export function isRenNoDataResponse(value: JsonObject): boolean {
  return isJsonString(value.message) && /there\s+is\s+no\s+data[\s\S]*selected\s+date/i.test(value.message);
}

/** What an empty day looks like in the collected document when REN answered with no body at all. */
function renNoDataDocument(): JsonObject {
  return { message: "There is no data for the selected date" };
}

export function defaultCollectionDays(now: Date): string[] {
  const today = lisbonDay(now);
  const yesterday = addDays(today, -1);
  return lisbonHour(now) >= 6 ? [yesterday, today] : [yesterday];
}

export function dotNetTicks(day: string): string {
  return (BigInt(Date.parse(`${day}T00:00:00.000Z`)) * 10_000n + DOTNET_UNIX_EPOCH_TICKS).toString();
}

function endpointFor(origin: string, path: string, day: string): URL {
  const endpoint = new URL(path, origin);
  endpoint.searchParams.set("culture", "en-GB");
  endpoint.searchParams.set("dayToSearchString", dotNetTicks(day));
  return endpoint;
}

function isRenServiceName(value: string | undefined): value is RenServiceName {
  return value !== undefined && Object.hasOwn(REN_SERVICES, value);
}

function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isChartResponse(value: JsonValue | undefined): value is JsonObject {
  if (!isJsonObject(value) || !isJsonObject(value.xAxis) || !isJsonObject(value.yAxis)) {
    return false;
  }
  return Array.isArray(value.xAxis.categories) && Array.isArray(value.series);
}

function chartHasSeriesData(chart: JsonObject, definition: RenServiceDefinition): boolean {
  const series = Array.isArray(chart.series) ? chart.series : [];
  return series.some((item) => {
    if (!isJsonObject(item) || !isJsonString(item.name) || !Array.isArray(item.data)) {
      return false;
    }
    if (definition.selectedSeries !== undefined && !definition.selectedSeries.includes(item.name)) {
      return false;
    }
    return item.data.some((point) => isJsonNumber(point) && Number.isFinite(point));
  });
}

function responseTooLarge(): never {
  throw new GatekeeperError("REN Data Hub response exceeded 2 MiB", "response-too-large");
}

function exhaustedHistory(): SourceExhausted {
  return { kind: "exhausted" };
}

function upstreamError(service: RenServiceName, response: Response): GatekeeperError {
  return new GatekeeperError(`REN Data Hub returned HTTP ${response.status} for ${service}`, "upstream-error", retryAfterSeconds(response.headers));
}

function historyUpstreamError(service: RenServiceName, response: Response): GatekeeperError {
  return new GatekeeperError(`REN Data Hub returned HTTP ${response.status} for ${service} history`, "upstream-error", retryAfterSeconds(response.headers));
}

function historyBefore(value: string): Date {
  const before = new Date(value);
  if (Number.isNaN(before.getTime())) {
    throw new GatekeeperError("REN history cursor.before must be a valid date-time", "invalid-config");
  }
  return before;
}

function emptyDayToken(day: string): string {
  return `ren-empty-day:${day}`;
}

/** An upstream 304: the provider's validators win, the checkpoint's fill any gap. */
function notModified(upstream: Response, checkpoint: SourceValidator | undefined): SourceNotModified {
  const fetched: SourceNotModified = { kind: "not-modified" };
  const validator: SourceValidator = { ...checkpoint, ...responseValidator(upstream.headers) };
  if (validator.etag || validator.lastModified) fetched.validator = validator;
  return fetched;
}

function collectionIsComplete(document: RenCollectionDocument, definition: RenServiceDefinition, now: Date): boolean {
  const today = lisbonDay(now);
  return document.days.every(({ day, response }) => {
    if (day >= today) return false;
    const expected = expectedPointCount(day, definition.intervalMinutes);
    const series = Array.isArray(response.series) ? response.series : [];
    const selected = series.filter((item) => {
      if (!isJsonObject(item) || !isJsonString(item.name)) return false;
      return definition.selectedSeries === undefined || definition.selectedSeries.includes(item.name);
    });
    return selected.length > 0 && selected.every((item) => isJsonObject(item) && Array.isArray(item.data) && item.data.length >= expected);
  });
}

function expectedPointCount(day: string, intervalMinutes: number): number {
  const start = dayStart(day).getTime();
  const end = dayStart(addDays(day, 1)).getTime();
  return (end - start) / (intervalMinutes * 60_000);
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** The hour Lisbon's clock shows at a moment, so a collection knows whether today's chart is worth asking for. */
function lisbonHour(now: Date): number {
  return new Date(now.getTime() + lisbonOffsetMinutes(now.getTime()) * 60_000).getUTCHours();
}

/** Midnight starting a Europe/Lisbon civil day: the boundary REN publishes against. */
function dayStart(day: string): Date {
  const instant = lisbonInstants(day, "00:00")[0];
  if (!instant) throw new GatekeeperError(`REN asked for ${day}, which is not a calendar day`, "invalid-config");
  return instant;
}
