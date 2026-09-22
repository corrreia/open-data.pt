import {
  GatekeeperError,
  equivalentEtags,
  isoDate,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type HistoryCursor,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceProvenance,
  type SourceValidator,
  type SourceConfig,
} from "../../index";

export const INE_MAX_BYTES = 8 * 1024 * 1024;
export const INE_HISTORY_MAX_BYTES = INE_MAX_BYTES;

/**
 * INE indicators have different periodicities, so history uses period-count
 * slices rather than one misleading fixed duration: at most 12 monthly
 * periods, eight quarterly periods, or ten annual periods. The metadata's
 * dimension cardinalities can lower that maximum to keep a slice at roughly
 * 3,000 observations; this makes wide indicators such as crime rate use one
 * annual period while narrow monthly indicators still use all 12. Responses
 * also share the live feed's hard 8 MiB source cap. A single annual income
 * distribution already exceeds 2 MiB and cannot be split at a period boundary.
 */
const HISTORY_PERIODS = {
  annual: 10,
  monthly: 12,
  quarterly: 8,
} as const;
const HISTORY_TARGET_POINTS = 3_000;

export const INE_FEEDS = {
  indicator: {
    kind: "indicator",
    title: "Statistical indicator",
    description: "A complete snapshot of the latest values published for one INE indicator, as time-series points.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "time-series",
    },
    // The period span and earliest date vary by indicator and are discovered
    // from Dim1 metadata, so only the common cursor mode can be declared here.
    history: {},
  },
} as const satisfies Record<string, FeedKindDescription>;

/**
 * Live API shape checked on 2026-09-07:
 *
 * - `pindicaMeta.jsp` returns `[ { IndicadorCod, IndicadorNome, Periodic,
 *   UnidadeMedida, DataUltimaAtualizacao, Dimensoes: { Descricao_Dim,
 *   Categoria_Dim } } ]`.
 * - `pindica.jsp?op=2` returns `[ { IndicadorCod, IndicadorDsg,
 *   DataUltimoAtualizacao, Dados: { "<period label>": [ { geocod, geodsg,
 *   dim_3, dim_3_t, ..., valor, sinal_conv? } ] }, Sucesso } ]`.
 *
 * INE's current documentation names `pindicaMeta.jsp` as the metadata API.
 * The legacy `pindica.jsp?op=1` currently returns a very large `Pref` data
 * history (63 MiB for indicator 0004167), not metadata, so it cannot be used
 * within this Gatekeeper's 8 MiB acquisition boundary.
 */
export function validateIneFeedConfig(config: SourceConfig): SourceConfig {
  const unknown = Object.keys(config).filter((key) => key !== "indicator" && key !== "lang" && key !== "dims");
  if (unknown.length > 0) {
    throw new GatekeeperError(`INE indicator config does not accept ${unknown.sort().join(", ")}`, "invalid-config");
  }

  const indicator = config.indicator?.trim();
  if (!indicator || !/^\d{7}$/.test(indicator)) {
    throw new GatekeeperError("INE indicator config requires indicator as exactly seven digits", "invalid-config");
  }

  const lang = (config.lang?.trim() || "PT").toUpperCase();
  if (lang !== "PT" && lang !== "EN") {
    throw new GatekeeperError("INE indicator config requires lang=PT or lang=EN", "invalid-config");
  }

  const validated: SourceConfig = { indicator, lang };
  const dims = config.dims?.trim();
  if (dims) validated.dims = normalizeDims(dims);
  return validated;
}

export async function collectIneIndicator(config: SourceConfig, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateIneFeedConfig(config);
  const origin = validatedOrigin(apiOrigin);
  const indicator = validated.indicator;
  const lang = validated.lang;
  if (!indicator || !lang) {
    throw new GatekeeperError("INE config normalization failed", "invalid-config");
  }

  const metaUrl = ineUrl(origin, "/ine/json_indicador/pindicaMeta.jsp", {
    varcd: indicator,
    lang,
  });
  const dataUrl = ineUrl(origin, "/ine/json_indicador/pindica.jsp", {
    op: "2",
    varcd: indicator,
    lang,
  });
  appendDimensions(dataUrl, validated.dims);

  const requestHeaders = conditionalHeaders(checkpoint);
  const metaResponse = await upstreamFetch(fetcher, metaUrl, requestHeaders);
  if (metaResponse.status === 304) {
    return notModified(checkpoint?.etag, metaResponse.headers);
  }
  requireSuccessfulResponse(metaResponse, "metadata");
  const metaBytes = await readBoundedResponse(metaResponse, INE_MAX_BYTES, "INE metadata response");
  const meta = parseSingleObject(metaBytes, "metadata");
  validateIndicatorResponse(meta, indicator, "metadata", false);
  const metadataUpdate = optionalNonEmptyString(meta.DataUltimaAtualizacao);
  const metadataEtag = metadataUpdate ? syntheticEtag(metadataUpdate) : undefined;

  if (metadataEtag && checkpoint?.etag && equivalentEtags(checkpoint.etag, metadataEtag)) {
    return notModified(metadataEtag, metaResponse.headers);
  }

  const wrapperBytes = byteLength('{"meta":,"data":}');
  const remaining = INE_MAX_BYTES - metaBytes.byteLength - wrapperBytes;
  if (remaining <= 0) {
    throw tooLarge();
  }

  const dataResponse = await upstreamFetch(
    fetcher,
    dataUrl,
    new Headers({
      Accept: "application/json",
    }),
  );
  requireSuccessfulResponse(dataResponse, "data");
  const dataBytes = await readBoundedResponse(dataResponse, remaining, "INE data response");
  const data = parseSingleObject(dataBytes, "data");
  validateIndicatorResponse(data, indicator, "data", true);
  const dataUpdate = optionalNonEmptyString(data.DataUltimoAtualizacao);
  const sourceUpdate = dataUpdate ?? metadataUpdate;
  const etag = sourceUpdate ? syntheticEtag(sourceUpdate) : undefined;
  const body = joinJsonDocuments(metaBytes, dataBytes);
  if (body.byteLength > INE_MAX_BYTES) {
    throw tooLarge();
  }

  const provenance: SourceProvenance = { sourceUrl: dataUrl.toString() };
  const publishedAt = isoDate(sourceUpdate);
  if (publishedAt) provenance.sourcePublishedAt = publishedAt;
  const collected: SourceBody = { kind: "body", body, provenance, completeness: "complete" };
  const validator: SourceValidator = {};
  if (etag) validator.etag = etag;
  const lastModified = dataResponse.headers.get("last-modified") ?? metaResponse.headers.get("last-modified");
  if (lastModified) validator.lastModified = lastModified;
  if (Object.keys(validator).length > 0) collected.validator = validator;
  return collected;
}

/**
 * Collect one bounded set of INE periods strictly before `cursor.before`.
 * Metadata is fetched once to discover ordered Dim1 period codes; INE accepts
 * comma-separated codes, so the selected periods are fetched in one data
 * request and returned in the same `{ meta, data }` shape as live collection.
 */
export async function collectIneIndicatorHistory(config: SourceConfig, cursor: HistoryCursor, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateIneFeedConfig(config);
  const origin = validatedOrigin(apiOrigin);
  const indicator = validated.indicator;
  const lang = validated.lang;
  if (!indicator || !lang) {
    throw new GatekeeperError("INE config normalization failed", "invalid-config");
  }
  const before = historyBefore(cursor.before);
  const metaUrl = ineUrl(origin, "/ine/json_indicador/pindicaMeta.jsp", {
    varcd: indicator,
    lang,
  });
  const dataUrl = ineUrl(origin, "/ine/json_indicador/pindica.jsp", {
    op: "2",
    varcd: indicator,
    lang,
  });
  appendDimensions(dataUrl, validated.dims);

  const metaResponse = await upstreamFetch(fetcher, metaUrl, new Headers({ Accept: "application/json" }));
  requireSuccessfulResponse(metaResponse, "metadata");
  const metaBytes = await readBoundedResponse(metaResponse, INE_HISTORY_MAX_BYTES, "INE metadata response");
  const meta = parseSingleObject(metaBytes, "metadata");
  validateIndicatorResponse(meta, indicator, "metadata", false);

  const periods = readHistoryPeriods(meta);
  const eligible = periods.filter((period) => period.start < before);
  const selected = eligible.slice(0, historyPeriodCount(meta, validated.dims));
  if (selected.length === 0) return { kind: "exhausted" };

  dataUrl.searchParams.set("Dim1", selected.map((period) => period.code).join(","));
  const wrapperBytes = byteLength('{"meta":,"data":}');
  const remaining = INE_HISTORY_MAX_BYTES - metaBytes.byteLength - wrapperBytes;
  if (remaining <= 0) throw historyTooLarge();

  const dataResponse = await upstreamFetch(fetcher, dataUrl, new Headers({ Accept: "application/json" }));
  requireSuccessfulResponse(dataResponse, "data");
  const dataBytes = await readBoundedResponse(dataResponse, remaining, "INE data response");
  const data = parseSingleObject(dataBytes, "data");
  validateIndicatorResponse(data, indicator, "data", true);
  validateHistoryDataPeriods(data, selected);

  const body = joinJsonDocuments(metaBytes, dataBytes);
  if (body.byteLength > INE_HISTORY_MAX_BYTES) throw historyTooLarge();
  const oldest = selected.at(-1);
  if (!oldest) {
    throw new GatekeeperError("INE history period selection failed", "invalid-response");
  }
  const slice: SourceBody = {
    kind: "body",
    body,
    provenance: { sourceUrl: dataUrl.toString() },
    completeness: "complete",
  };
  if (eligible.length > selected.length) slice.next = { before: oldest.start };
  else slice.exhausted = true;
  return slice;
}

interface HistoryPeriod {
  code: string;
  label: string;
  start: string;
}

function readHistoryPeriods(meta: JsonObject): HistoryPeriod[] {
  if (!isJsonObject(meta.Dimensoes) || !Array.isArray(meta.Dimensoes.Categoria_Dim)) {
    throw invalidHistoryMetadata();
  }
  const byCode = new Map<string, HistoryPeriod>();
  for (const group of meta.Dimensoes.Categoria_Dim) {
    if (!isJsonObject(group)) continue;
    for (const categories of Object.values(group)) {
      if (!Array.isArray(categories)) continue;
      for (const value of categories) {
        if (!isJsonObject(value) || String(value.dim_num) !== "1") continue;
        const code = optionalNonEmptyString(value.categ_cod);
        const label = optionalNonEmptyString(value.categ_dsg);
        const order = optionalNonEmptyString(value.categ_ord);
        const start = order ? historyDateFromOrder(order) : undefined;
        if (code && label && start) byCode.set(code, { code, label, start });
      }
    }
  }
  const periods = [...byCode.values()].sort((left, right) => right.start.localeCompare(left.start));
  if (periods.length === 0) throw invalidHistoryMetadata();
  return periods;
}

function historyPeriodCount(meta: JsonObject, dims: string | undefined): number {
  const normalized = normalizeHistoryLabel(optionalNonEmptyString(meta.Periodic) ?? "");
  let maximum: number = HISTORY_PERIODS.annual;
  if (normalized.includes("mensal") || normalized.includes("monthly")) {
    maximum = HISTORY_PERIODS.monthly;
  } else if (normalized.includes("trimestral") || normalized.includes("quarterly")) {
    maximum = HISTORY_PERIODS.quarterly;
  }

  const filters = new URLSearchParams(dims);
  const categories = historyDimensionCategories(meta);
  let rowsPerPeriod = 1;
  for (const [number, codes] of categories) {
    if (number === 1) continue;
    const filter = filters.get(`Dim${number}`);
    const count = filter ? filter.split(",").length : codes.size;
    rowsPerPeriod *= Math.max(1, count);
    if (rowsPerPeriod >= HISTORY_TARGET_POINTS) break;
  }
  const pointBound = Math.max(1, Math.floor(HISTORY_TARGET_POINTS / rowsPerPeriod));
  return Math.min(maximum, pointBound);
}

function historyDimensionCategories(meta: JsonObject): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>();
  if (!isJsonObject(meta.Dimensoes) || !Array.isArray(meta.Dimensoes.Categoria_Dim)) {
    return result;
  }
  for (const group of meta.Dimensoes.Categoria_Dim) {
    if (!isJsonObject(group)) continue;
    for (const values of Object.values(group)) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (!isJsonObject(value)) continue;
        const number = Number(value.dim_num);
        const code = optionalNonEmptyString(value.categ_cod);
        if (!Number.isInteger(number) || number < 1 || !code) continue;
        const codes = result.get(number) ?? new Set<string>();
        codes.add(code);
        result.set(number, codes);
      }
    }
  }
  return result;
}

function historyDateFromOrder(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const milliseconds = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) {
    return undefined;
  }
  return date.toISOString();
}

function historyBefore(value: string): string {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new GatekeeperError("INE history cursor.before must be an ISO 8601 date", "invalid-config");
  }
  return new Date(milliseconds).toISOString();
}

function validateHistoryDataPeriods(data: JsonObject, selected: HistoryPeriod[]): void {
  if (!isJsonObject(data.Dados)) return;
  const allowed = new Set(selected.flatMap((period) => [normalizeHistoryLabel(period.label), normalizeHistoryLabel(period.code)]));
  const returned = new Set(Object.keys(data.Dados).map((label) => normalizeHistoryLabel(label)));
  for (const label of returned) {
    if (!allowed.has(label)) {
      throw new GatekeeperError(`INE data response returned unrequested history period ${label}`, "invalid-response");
    }
  }
  const missing = selected.find((period) => !returned.has(normalizeHistoryLabel(period.label)) && !returned.has(normalizeHistoryLabel(period.code)));
  if (missing) {
    throw new GatekeeperError(`INE data response omitted requested history period ${missing.label}`, "invalid-response");
  }
}

function normalizeHistoryLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function invalidHistoryMetadata(): GatekeeperError {
  return new GatekeeperError("INE metadata did not list ordered Dim1 period categories", "invalid-response");
}

function historyTooLarge(): GatekeeperError {
  return new GatekeeperError(`INE history response exceeded ${INE_HISTORY_MAX_BYTES} bytes`, "response-too-large");
}

function normalizeDims(value: string): string {
  if (value.length > 2_048) {
    throw new GatekeeperError("INE dims must not exceed 2048 characters", "invalid-config");
  }
  const parsed = new URLSearchParams(value);
  const dimensions: Array<[number, string]> = [];
  const seen = new Set<number>();
  for (const [rawKey, rawValue] of parsed) {
    const match = /^dim(\d+)$/i.exec(rawKey);
    const number = match?.[1] ? Number(match[1]) : 0;
    if (!match || number < 1 || number > 99 || seen.has(number) || rawValue.length === 0 || !/^[A-Za-z0-9*<>.,_@-]+$/.test(rawValue)) {
      throw new GatekeeperError("INE dims must be unique Dim1..Dim99 parameters with comma-separated category codes", "invalid-config");
    }
    seen.add(number);
    dimensions.push([number, rawValue]);
  }
  if (dimensions.length === 0) {
    throw new GatekeeperError("INE dims must contain at least one dimension filter", "invalid-config");
  }
  dimensions.sort(([left], [right]) => left - right);
  return dimensions.map(([number, dimensionValue]) => `Dim${number}=${encodeURIComponent(dimensionValue)}`).join("&");
}

function appendDimensions(url: URL, dims: string | undefined): void {
  if (!dims) return;
  for (const [key, value] of new URLSearchParams(dims)) {
    url.searchParams.set(key, value);
  }
}

function validatedOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("INE API origin is invalid", "source-denied");
  }
  if (url.origin !== "https://www.ine.pt" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new GatekeeperError("INE requests are restricted to https://www.ine.pt", "source-denied");
  }
  return url;
}

function ineUrl(origin: URL, pathname: string, parameters: Record<string, string>): URL {
  const url = new URL(pathname, origin);
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  return url;
}

function conditionalHeaders(checkpoint: SourceValidator | undefined): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (checkpoint?.etag) headers.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    headers.set("If-Modified-Since", checkpoint.lastModified);
  }
  return headers;
}

async function upstreamFetch(fetcher: typeof fetch, url: URL, headers: Headers): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, { headers });
      // INE intermittently answers 200 with an explicitly empty body. It is a
      // transient upstream failure, not a valid empty indicator response.
      if (response.ok && response.headers.get("content-length") === "0") {
        lastError = new Error("empty successful response");
        continue;
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  const detail = lastError ? `: ${lastError.message}` : "";
  throw new GatekeeperError(`INE request failed after 3 attempts${detail}`, "upstream-error");
}

function requireSuccessfulResponse(response: Response, resource: string): void {
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`INE ${resource} endpoint returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
}

function parseSingleObject(bytes: Uint8Array, resource: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`INE ${resource} response was not valid JSON`, "invalid-response");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isJsonObject(parsed[0])) {
    throw new GatekeeperError(`INE ${resource} response did not contain one indicator`, "invalid-response");
  }
  return parsed[0];
}

function validateIndicatorResponse(response: JsonObject, indicator: string, resource: string, requiresData: boolean): void {
  if (isJsonObject(response.Sucesso) && Array.isArray(response.Sucesso.Falso)) {
    const failure = response.Sucesso.Falso.find(isJsonObject);
    const detail = failure ? optionalNonEmptyString(failure.Msg) : undefined;
    throw new GatekeeperError(`INE ${resource} endpoint reported a failure${detail ? `: ${detail}` : ""}`, "upstream-error");
  }
  if (response.IndicadorCod !== indicator) {
    throw new GatekeeperError(`INE ${resource} response did not match indicator ${indicator}`, "invalid-response");
  }
  if (requiresData) {
    if (!isJsonObject(response.Dados) || !optionalNonEmptyString(response.DataUltimoAtualizacao)) {
      throw new GatekeeperError("INE data response omitted Dados or DataUltimoAtualizacao", "invalid-response");
    }
    return;
  }
  if (!isJsonObject(response.Dimensoes) || !optionalNonEmptyString(response.UnidadeMedida) || !optionalNonEmptyString(response.DataUltimaAtualizacao)) {
    throw new GatekeeperError("INE metadata response omitted dimensions, unit, or update date", "invalid-response");
  }
}

function joinJsonDocuments(metaBytes: Uint8Array, dataBytes: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode('{"meta":');
  const middle = new TextEncoder().encode(',"data":');
  const suffix = new TextEncoder().encode("}");
  const result = new Uint8Array(prefix.byteLength + metaBytes.byteLength + middle.byteLength + dataBytes.byteLength + suffix.byteLength);
  let offset = 0;
  for (const part of [prefix, metaBytes, middle, dataBytes, suffix]) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

/** An unchanged indicator; INE's own ETag, when it sends one, wins over the fallback. */
function notModified(etag: string | undefined, upstreamHeaders: Headers): SourceFetch {
  const validator: SourceValidator = {};
  const resolvedEtag = upstreamHeaders.get("etag") ?? etag;
  if (resolvedEtag) validator.etag = resolvedEtag;
  const lastModified = upstreamHeaders.get("last-modified");
  if (lastModified) validator.lastModified = lastModified;
  return Object.keys(validator).length > 0 ? { kind: "not-modified", validator } : { kind: "not-modified" };
}

function syntheticEtag(sourceUpdate: string): string {
  return `"${sourceUpdate.replaceAll('"', "")}"`;
}

function optionalNonEmptyString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : undefined;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function tooLarge(): GatekeeperError {
  return new GatekeeperError("INE response exceeded 8 MiB", "response-too-large");
}
