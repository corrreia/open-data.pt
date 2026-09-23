import {
  GatekeeperError,
  asNumberList,
  asObject,
  asStringList,
  equivalentEtags,
  invalidResponse,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  isoDate,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type HistoryCursor,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceValidator,
  type SourceConfig,
} from "#/index";
import { normalizeEurostatPeriod, validateEurostatDatasetStructure } from "./transform";

export const EUROSTAT_MAX_BYTES = 8 * 1024 * 1024;
export const EUROSTAT_HISTORY_MAX_BYTES = 1024 * 1024;
const EUROSTAT_ORIGIN = "https://ec.europa.eu";
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_MAX_BYTES = 64 * 1024;
const DATASET_PATTERN = /^[a-z0-9_]{2,40}$/;
const FILTER_KEY_PATTERN = /^[a-z0-9_]+$/;
const FILTER_VALUE_PATTERN = /^[A-Za-z0-9_.-]+$/;
const RESERVED_FILTER_KEYS = new Set(["lang", "lastTimePeriod", "sinceTimePeriod", "untilTimePeriod"]);
const HISTORY_PERIODS = 120;
const HISTORY_MAX_OBSERVATIONS = 3_000;

export const EUROSTAT_FEEDS = {
  dataset: {
    kind: "dataset",
    title: "Eurostat statistical dataset",
    description: "A bounded Portugal-focused snapshot of one Eurostat JSON-stat 2.0 dataset, published once as time-series points.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "time-series",
    },
    history: {
      // Monthly feeds are the densest common case: 120 periods is ten years.
      // Quarterly feeds use the same point budget (30 years); annual feeds fit
      // their full history in one slice. History responses are capped at 1 MiB.
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateEurostatFeedConfig(config: SourceConfig): SourceConfig {
  const accepted = new Set(["dataset", "filters", "lastTimePeriod", "lang", "unit"]);
  const unknown = Object.keys(config).filter((key) => !accepted.has(key));
  if (unknown.length > 0) {
    throw new GatekeeperError(`Eurostat dataset config does not accept ${unknown.sort().join(", ")}`, "invalid-config");
  }

  const dataset = config.dataset?.trim().toLowerCase();
  if (!dataset || !DATASET_PATTERN.test(dataset)) {
    throw new GatekeeperError("Eurostat dataset config requires dataset to match ^[a-z0-9_]{2,40}$", "invalid-config");
  }

  const filters = normalizeFilters(config.filters);
  const rawLastTimePeriod = config.lastTimePeriod?.trim() || "120";
  if (!/^\d+$/.test(rawLastTimePeriod)) {
    throw new GatekeeperError("Eurostat dataset config requires lastTimePeriod from 1 to 600", "invalid-config");
  }
  const lastTimePeriod = Number(rawLastTimePeriod);
  if (!Number.isSafeInteger(lastTimePeriod) || lastTimePeriod < 1 || lastTimePeriod > 600) {
    throw new GatekeeperError("Eurostat dataset config requires lastTimePeriod from 1 to 600", "invalid-config");
  }

  const lang = (config.lang?.trim() || "EN").toUpperCase();
  if (lang !== "EN" && lang !== "FR" && lang !== "DE") {
    throw new GatekeeperError("Eurostat dataset config requires lang=EN, lang=FR, or lang=DE", "invalid-config");
  }

  const validated: SourceConfig = {
    dataset,
    filters,
    lastTimePeriod: String(lastTimePeriod),
    lang,
  };
  // Some datasets have no unit dimension; the example may state the documented unit.
  const unit = config.unit?.trim();
  if (unit) {
    if (unit.length > 80 || !UNIT_PATTERN.test(unit)) {
      throw new GatekeeperError("Eurostat dataset config unit must be plain text of at most 80 characters", "invalid-config");
    }
    validated.unit = unit;
  }
  return validated;
}

/** A stated unit: letters, digits, spaces and the punctuation units use. */
const UNIT_PATTERN = /^[\p{L}\p{N} .,()%=/€²³-]+$/u;

export async function collectEurostatDataset(config: SourceConfig, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateEurostatFeedConfig(config);
  const origin = validatedOrigin(apiOrigin);
  const dataset = validated.dataset;
  const filters = validated.filters;
  const lastTimePeriod = validated.lastTimePeriod;
  const lang = validated.lang;
  if (!dataset || filters === undefined || !lastTimePeriod || !lang) {
    throw new GatekeeperError("Eurostat config normalization failed", "invalid-config");
  }

  const sourceUrl = datasetUrl(origin, dataset, filters, lastTimePeriod, lang);
  const headers = new Headers({ Accept: "application/json" });
  if (checkpoint?.etag) headers.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    headers.set("If-Modified-Since", checkpoint.lastModified);
  }

  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new GatekeeperError(`Eurostat request failed${detail}`, "upstream-error");
  }

  if (response.status === 304) {
    return notModified(checkpoint, response.headers);
  }
  if (response.status === 400) {
    const bytes = await readBoundedBody(response, ERROR_BODY_MAX_BYTES, () => new GatekeeperError("Eurostat error response exceeded 64 KiB", "invalid-config"));
    throw new GatekeeperError(eurostatErrorMessage(bytes) ?? "Eurostat rejected the dataset configuration", "invalid-config");
  }
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`Eurostat returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }

  const bytes = await readBoundedBody(response, EUROSTAT_MAX_BYTES, tooLarge);
  const datasetResponse = parseCollectedDataset(bytes);
  validateEurostatDatasetStructure(bytes);
  const publishedAt = isoDate(datasetResponse.updated);
  if (!publishedAt) {
    throw invalidResponse("Eurostat dataset did not provide a valid updated time");
  }
  const etag = syntheticEtag(dataset, publishedAt);
  const upstreamEtag = response.headers.get("etag") ?? undefined;
  if (checkpoint?.etag && (equivalentEtags(checkpoint.etag, etag) || (upstreamEtag !== undefined && equivalentEtags(checkpoint.etag, upstreamEtag)))) {
    return notModified({ ...checkpoint, etag }, response.headers, etag);
  }

  // The checkpoint keeps the synthetic publication ETag: it is what the next
  // run compares against, whatever validator Eurostat itself sent.
  const validator: SourceValidator = { etag };
  const lastModified = response.headers.get("last-modified");
  if (lastModified) validator.lastModified = lastModified;
  return {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: sourceUrl.toString(), sourcePublishedAt: publishedAt },
    completeness: "complete",
    validator,
  };
}

/**
 * Fetch one backwards history slice. Eurostat's Statistics API treats
 * sinceTimePeriod and untilTimePeriod as inclusive, so the requested upper
 * period is the period immediately before the exclusive cursor. Monthly and
 * quarterly slices contain at most 120 periods; annual series are short enough
 * to request everything before the cursor in one call. A 1 MiB/3,000-value cap
 * keeps every history artifact well below the feed policy's 8 MiB maximum.
 */
export async function collectEurostatDatasetHistory(config: SourceConfig, cursor: HistoryCursor, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateEurostatFeedConfig(config);
  const origin = validatedOrigin(apiOrigin);
  const dataset = validated.dataset;
  const filters = validated.filters;
  const lang = validated.lang;
  if (!dataset || filters === undefined || !lang) {
    throw new GatekeeperError("Eurostat config normalization failed", "invalid-config");
  }

  const before = historyBefore(cursor.before);
  const frequency = historyFrequency(dataset, filters);
  const range = historyRange(before, frequency);
  const sourceUrl = historyDatasetUrl(origin, dataset, filters, lang, range.since, range.until);

  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      headers: new Headers({ Accept: "application/json" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new GatekeeperError(`Eurostat history request failed${detail}`, "upstream-error");
  }

  if (response.status === 400) {
    const bytes = await readBoundedBody(response, ERROR_BODY_MAX_BYTES, () => new GatekeeperError("Eurostat history error response exceeded 64 KiB", "invalid-response"));
    if (isNoDataError(bytes)) return { kind: "exhausted" };
    throw new GatekeeperError(eurostatErrorMessage(bytes) ?? "Eurostat rejected the history query", "invalid-config");
  }
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`Eurostat history request returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }

  const bytes = await readBoundedBody(response, EUROSTAT_HISTORY_MAX_BYTES, historyTooLarge);
  const datasetResponse = parseCollectedDataset(bytes);
  const observations = historyObservations(datasetResponse);
  if (observations.empty) return { kind: "exhausted" };
  if (observations.count > HISTORY_MAX_OBSERVATIONS) throw historyTooLarge();
  validateEurostatDatasetStructure(bytes);

  const from = observations.earliest;
  if (!from || from >= before) {
    throw invalidResponse("Eurostat history response did not contain an event before the cursor");
  }
  const publishedAt = isoDate(datasetResponse.updated);
  if (!publishedAt) {
    throw invalidResponse("Eurostat history response did not provide a valid updated time");
  }

  const slice: SourceBody = {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: sourceUrl.toString(), sourcePublishedAt: publishedAt },
    completeness: "complete",
    // The next cursor is the oldest event itself: because `before` is
    // exclusive, the next request ends in the preceding period without gaps.
    next: { before: from },
  };
  return slice;
}

function normalizeFilters(value: string | undefined): string {
  const entries: Array<[string, string]> = [];
  if (value?.trim()) {
    const parameters = new URLSearchParams(value);
    for (const [key, filterValue] of parameters) {
      if (RESERVED_FILTER_KEYS.has(key)) {
        throw new GatekeeperError(`Eurostat filters cannot override ${key}`, "invalid-config");
      }
      if (!FILTER_KEY_PATTERN.test(key)) {
        throw new GatekeeperError(`Eurostat filter key ${JSON.stringify(key)} is invalid`, "invalid-config");
      }
      if (!FILTER_VALUE_PATTERN.test(filterValue)) {
        throw new GatekeeperError(`Eurostat filter value for ${key} is invalid`, "invalid-config");
      }
      entries.push([key, filterValue]);
    }
  }
  if (!entries.some(([key]) => key === "geo")) entries.push(["geo", "PT"]);
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const normalized = new URLSearchParams();
  for (const [key, filterValue] of entries) normalized.append(key, filterValue);
  return normalized.toString();
}

function validatedOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("Eurostat API origin is invalid", "source-denied");
  }
  if (url.origin !== EUROSTAT_ORIGIN || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new GatekeeperError(`Eurostat requests are restricted to ${EUROSTAT_ORIGIN}`, "source-denied");
  }
  return url;
}

function datasetUrl(origin: URL, dataset: string, filters: string, lastTimePeriod: string, lang: string): URL {
  const url = new URL(`/eurostat/api/dissemination/statistics/1.0/data/${dataset}`, origin);
  for (const [key, value] of new URLSearchParams(filters)) {
    url.searchParams.append(key, value);
  }
  url.searchParams.set("lang", lang);
  url.searchParams.set("lastTimePeriod", lastTimePeriod);
  return url;
}

function historyDatasetUrl(origin: URL, dataset: string, filters: string, lang: string, since: string | undefined, until: string): URL {
  const url = new URL(`/eurostat/api/dissemination/statistics/1.0/data/${dataset}`, origin);
  for (const [key, value] of new URLSearchParams(filters)) {
    url.searchParams.append(key, value);
  }
  url.searchParams.set("lang", lang);
  if (since) url.searchParams.set("sinceTimePeriod", since);
  url.searchParams.set("untilTimePeriod", until);
  return url;
}

type EurostatFrequency = "A" | "M" | "Q";

function historyFrequency(dataset: string, filters: string): EurostatFrequency {
  const configured = [...new Set(new URLSearchParams(filters).getAll("freq").map((value) => value.toUpperCase()))];
  if (configured.length === 1 && isHistoryFrequency(configured[0])) {
    return configured[0];
  }
  if (configured.length > 0) {
    throw new GatekeeperError("Eurostat history requires one freq filter with A, Q, or M", "invalid-config");
  }

  // Eurostat dataset codes conventionally expose frequency in a suffix or in
  // the national-accounts `nama`/`namq` family. The less regular monthly
  // examples below are established Eurostat dataset suffixes. Ambiguous
  // datasets can always state their frequency with the ordinary `freq` filter.
  if (/(?:^|_)namq(?:_|$)/.test(dataset) || /(?:^|_)q(?:_|$)/.test(dataset)) {
    return "Q";
  }
  if (/(?:^|_)nama(?:_|$)/.test(dataset) || /(?:^|_)a(?:_|$)/.test(dataset)) {
    return "A";
  }
  if (/(?:^|_)m(?:_|$)/.test(dataset) || /(?:^|_)(?:manr|nim)$/.test(dataset)) {
    return "M";
  }
  throw new GatekeeperError("Eurostat history could not infer the dataset frequency; add freq=A, freq=Q, or freq=M to filters", "invalid-config");
}

function isHistoryFrequency(value: string | undefined): value is EurostatFrequency {
  return value === "A" || value === "M" || value === "Q";
}

function historyBefore(value: string): string {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new GatekeeperError("Eurostat history cursor.before must be an ISO 8601 date", "invalid-config");
  }
  return new Date(milliseconds).toISOString();
}

/** The period span one history slice asks Eurostat for. */
interface HistoryRange {
  since?: string;
  until: string;
}

function historyRange(before: string, frequency: EurostatFrequency): HistoryRange {
  const date = new Date(before);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (frequency === "A") return { until: String(year - 1) };

  const periodMonth = frequency === "Q" ? Math.floor(month / 3) * 3 : month;
  const monthsPerPeriod = frequency === "Q" ? 3 : 1;
  const until = new Date(Date.UTC(year, periodMonth - monthsPerPeriod, 1));
  const since = new Date(until);
  since.setUTCMonth(since.getUTCMonth() - (HISTORY_PERIODS - 1) * monthsPerPeriod);
  return {
    since: formatEurostatPeriod(since, frequency),
    until: formatEurostatPeriod(until, frequency),
  };
}

function formatEurostatPeriod(date: Date, frequency: "M" | "Q"): string {
  const year = date.getUTCFullYear();
  if (frequency === "Q") {
    return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  }
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * A Eurostat body under a byte budget, reported with the caller's own error:
 * an oversized dataset, an oversized history slice and an oversized error
 * document each mean something different to the collection that asked.
 */
async function readBoundedBody(response: Response, maximumBytes: number, error: () => GatekeeperError): Promise<Uint8Array> {
  try {
    return await readBoundedResponse(response, maximumBytes, "Eurostat response");
  } catch (problem) {
    if (problem instanceof GatekeeperError && problem.code === "response-too-large") throw error();
    throw problem;
  }
}

function parseCollectedDataset(bytes: Uint8Array): JsonObject & { updated: string } {
  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse("Eurostat returned invalid JSON");
  }
  if (
    !isJsonObject(parsed) ||
    parsed.version !== "2.0" ||
    parsed.class !== "dataset" ||
    !isJsonString(parsed.updated) ||
    !Array.isArray(parsed.id) ||
    !Array.isArray(parsed.size) ||
    !isJsonObject(parsed.dimension) ||
    !isJsonObject(parsed.value)
  ) {
    throw invalidResponse("Eurostat response was not a JSON-stat 2.0 dataset");
  }
  // SAFETY: the checks above confirm `updated` is a string, alongside the id,
  // size, dimension and value members a JSON-stat dataset carries.
  return parsed as JsonObject & { updated: string };
}

/** What one history slice held: how many observations, and the oldest one. */
interface HistoryObservations {
  count: number;
  earliest?: string;
  empty: boolean;
}

function historyObservations(dataset: JsonObject): HistoryObservations {
  const value = dataset.value;
  if (!isJsonObject(value)) {
    throw invalidResponse("Eurostat history response omitted its values");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return { count: 0, empty: true };

  const ids = asStringList(dataset.id);
  const sizes = asNumberList(dataset.size);
  const dimensions = asObject(dataset.dimension);
  if (ids === undefined || sizes === undefined || !sizes.every((size) => Number.isSafeInteger(size) && size >= 0) || dimensions === undefined) {
    throw invalidResponse("Eurostat history response dimensions were malformed");
  }
  const timeIndex = ids.indexOf("time");
  const timeDimension = dimensions.time;
  if (timeIndex < 0 || !isJsonObject(timeDimension) || !isJsonObject(timeDimension.category)) {
    throw invalidResponse("Eurostat history response omitted its time dimension");
  }
  const codes = historyCategoryCodes(timeDimension.category.index);
  const stride = sizes.slice(timeIndex + 1).reduce((product, size) => product * size, 1);
  const timeSize = sizes[timeIndex];
  if (!timeSize || stride < 1 || codes.length !== timeSize) {
    throw invalidResponse("Eurostat history time dimension was malformed");
  }

  let count = 0;
  let earliest: string | undefined;
  for (const [rawIndex, rawValue] of entries) {
    if (!isJsonNumber(rawValue) || !Number.isFinite(rawValue)) continue;
    const flatIndex = Number(rawIndex);
    if (!/^\d+$/.test(rawIndex) || !Number.isSafeInteger(flatIndex)) {
      throw invalidResponse("Eurostat history response contained an invalid value index");
    }
    const position = Math.floor(flatIndex / stride) % timeSize;
    const period = codes[position];
    const date = period ? normalizeEurostatPeriod(period) : undefined;
    if (!date) {
      throw invalidResponse("Eurostat history response contained an invalid event period");
    }
    const eventTime = `${date}T00:00:00Z`;
    if (!earliest || eventTime < earliest) earliest = eventTime;
    count += 1;
  }
  const observations: HistoryObservations = { count, empty: false };
  if (earliest) observations.earliest = earliest;
  return observations;
}

function historyCategoryCodes(value: JsonValue | undefined): string[] {
  if (Array.isArray(value) && value.every((code) => isJsonString(code))) {
    return [...value];
  }
  if (!isJsonObject(value)) {
    throw invalidResponse("Eurostat history time categories were malformed");
  }
  const entries = Object.entries(value);
  if (!entries.every(([, position]) => isJsonNumber(position) && Number.isSafeInteger(position) && position >= 0)) {
    throw invalidResponse("Eurostat history time category positions were malformed");
  }
  entries.sort(([, left], [, right]) => Number(left) - Number(right));
  return entries.map(([code]) => code);
}

function eurostatErrorMessage(bytes: Uint8Array): string | undefined {
  try {
    const parsed: JsonValue = parseJsonBytes(bytes);
    if (!isJsonObject(parsed) || !Array.isArray(parsed.error)) return undefined;
    const labels = parsed.error.flatMap((item) => (isJsonObject(item) && isJsonString(item.label) && item.label.trim() ? [item.label.trim()] : []));
    return labels.length > 0 ? `Eurostat rejected the dataset configuration: ${labels.join("; ")}` : undefined;
  } catch {
    return undefined;
  }
}

function isNoDataError(bytes: Uint8Array): boolean {
  try {
    const parsed: JsonValue = parseJsonBytes(bytes);
    if (!isJsonObject(parsed) || !Array.isArray(parsed.error)) return false;
    const labels = parsed.error.flatMap((item) => (isJsonObject(item) && isJsonString(item.label) ? [item.label] : []));
    return labels.length > 0 && labels.every((label) => /(?:no[_ ]results?|no data|no observations?|results? not found)/i.test(label));
  } catch {
    return false;
  }
}

function notModified(checkpoint: SourceValidator | undefined, upstreamHeaders: Headers, etagOverride?: string): SourceFetch {
  const validator: SourceValidator = {};
  const etag = etagOverride ?? upstreamHeaders.get("etag") ?? checkpoint?.etag;
  const lastModified = upstreamHeaders.get("last-modified") ?? checkpoint?.lastModified;
  if (etag) validator.etag = etag;
  if (lastModified) validator.lastModified = lastModified;
  return Object.keys(validator).length > 0 ? { kind: "not-modified", validator } : { kind: "not-modified" };
}

function syntheticEtag(dataset: string, updated: string): string {
  return `"${dataset}:${updated}"`;
}

function tooLarge(): GatekeeperError {
  return new GatekeeperError("Eurostat response exceeded 8 MiB", "response-too-large");
}

function historyTooLarge(): GatekeeperError {
  return new GatekeeperError("Eurostat history slice exceeded 1 MiB or 3,000 observations", "response-too-large");
}
