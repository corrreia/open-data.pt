import {
  GatekeeperError,
  contentEtag,
  equivalentEtags,
  invalidResponse,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  isoDate,
  parseJsonBytes,
  readBoundedResponse,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
  type SourceConfig,
} from "../../index";

// JSON-stat is buffered. Keep its source budget small; scoped examples use the
// provider's series_ids and obs_last_n filters instead of downloading broad
// domains. Whole-dataset pagination still reports partial at this cap.
export const BPSTAT_MAX_BYTES = 2 * 1024 * 1024;
const BPSTAT_ORIGIN = "https://bpstat.bportugal.pt";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES = 1_000;
const WRAPPER_BYTES = new TextEncoder().encode('{"pages":[]}').byteLength;

export const BPSTAT_FEEDS = {
  dataset: {
    kind: "dataset",
    title: "Statistical dataset",
    description:
      "A bounded snapshot of one BPstat JSON-stat 2.0 dataset, published once as time-series points.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "time-series",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateBpstatFeedConfig(config: SourceConfig): SourceConfig {
  const unknown = Object.keys(config).filter(
    (key) => !["domain", "dataset", "lang", "seriesIds", "lastN"].includes(key),
  );
  if (unknown.length > 0) {
    throw new GatekeeperError(`BPstat dataset config does not accept ${unknown.sort().join(", ")}`, "invalid-config");
  }

  const rawDomain = config.domain?.trim();
  if (!rawDomain || !/^[1-9]\d*$/.test(rawDomain)) {
    throw new GatekeeperError("BPstat dataset config requires domain as a positive integer", "invalid-config");
  }
  const domainNumber = Number(rawDomain);
  if (!Number.isSafeInteger(domainNumber)) {
    throw new GatekeeperError("BPstat dataset config domain is outside the supported integer range", "invalid-config");
  }

  const dataset = config.dataset?.trim().toLowerCase();
  if (!dataset || !/^[0-9a-f]{32}$/.test(dataset)) {
    throw new GatekeeperError("BPstat dataset config requires dataset as a 32-character hexadecimal ID", "invalid-config");
  }

  const lang = (config.lang?.trim() || "PT").toUpperCase();
  if (lang !== "PT" && lang !== "EN") {
    throw new GatekeeperError("BPstat dataset config requires lang=PT or lang=EN", "invalid-config");
  }

  const normalized: SourceConfig = { domain: String(domainNumber), dataset, lang };
  if (config.seriesIds !== undefined) {
    const ids = config.seriesIds.split(",").map((id) => id.trim());
    if (ids.length > 100 || ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new GatekeeperError("seriesIds must be 1..100 positive integer series IDs", "invalid-config");
    normalized.seriesIds = [...new Set(ids)].sort((a, b) => Number(a) - Number(b)).join(",");
  }
  if (config.lastN !== undefined) {
    const count = Number(config.lastN);
    if (!/^\d+$/.test(config.lastN) || !Number.isSafeInteger(count) || count < 1 || count > 366) throw new GatekeeperError("lastN must be 1..366 observations per series", "invalid-config");
    normalized.lastN = String(count);
  }
  return normalized;
}

export async function collectBpstatDataset(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
): Promise<SourceFetch> {
  const validated = validateBpstatFeedConfig(config);
  const origin = validatedOrigin(apiOrigin);
  const domain = validated.domain;
  const dataset = validated.dataset;
  const lang = validated.lang;
  if (!domain || !dataset || !lang) {
    throw new GatekeeperError("BPstat config normalization failed", "invalid-config");
  }

  const sourceUrl = datasetUrl(origin, domain, dataset, lang);
  if (validated.seriesIds) sourceUrl.searchParams.set("series_ids", validated.seriesIds);
  if (validated.lastN) sourceUrl.searchParams.set("obs_last_n", validated.lastN);
  const firstResponse = await upstreamFetch(
    fetcher,
    sourceUrl,
    conditionalHeaders(checkpoint),
  );
  if (firstResponse.status === 304) {
    return notModified(checkpoint, firstResponse.headers);
  }
  requireSuccessfulResponse(firstResponse);

  const firstBytes = await readPage(firstResponse, BPSTAT_MAX_BYTES - WRAPPER_BYTES, false);
  if (!firstBytes) throw tooLarge();
  const firstPage = parseDatasetPage(firstBytes);
  validateDatasetIdentity(firstPage, sourceUrl, domain, dataset, lang);
  validateSelectedSeries(firstPage, validated);

  const sourcePublishedAt = sourcePublicationTime(
    firstPage,
    firstResponse.headers,
  );
  const sourceEtag = sourcePublishedAt
    ? syntheticEtag(domain, dataset, lang, sourcePublishedAt)
    : firstResponse.headers.get("etag") ?? undefined;
  if (
    sourceEtag &&
    checkpoint?.etag &&
    equivalentEtags(sourceEtag, checkpoint.etag)
  ) {
    return notModified({ ...checkpoint, etag: sourceEtag }, firstResponse.headers);
  }

  const pages = [firstBytes];
  let nextPage = nextPageNumber(firstPage, sourceUrl, 1);
  const paginated = nextPage !== undefined;
  let partial = false;
  while (nextPage !== undefined) {
    if (pages.length >= MAX_PAGES) {
      partial = true;
      break;
    }
    const pageUrl = new URL(sourceUrl);
    pageUrl.searchParams.set("page", String(nextPage));
    const response = await upstreamFetch(
      fetcher,
      pageUrl,
      new Headers({ Accept: "application/json" }),
    );
    requireSuccessfulResponse(response);
    const remaining =
      BPSTAT_MAX_BYTES - WRAPPER_BYTES - pages.length - totalBytes(pages);
    if (remaining <= 0) {
      await response.body?.cancel("BPstat response reached its size cap");
      partial = true;
      break;
    }
    const pageBytes = await readPage(response, remaining, true);
    if (!pageBytes) {
      partial = true;
      break;
    }
    const page = parseDatasetPage(pageBytes);
    validateDatasetIdentity(page, pageUrl, domain, dataset, lang);
    validateSelectedSeries(page, validated);
    pages.push(pageBytes);
    nextPage = nextPageNumber(page, sourceUrl, nextPage);
  }

  const body = paginated ? combinePages(pages) : firstBytes;
  if (body.byteLength > BPSTAT_MAX_BYTES) throw tooLarge();
  const etag = sourceEtag ?? (await contentEtag(body));
  if (
    !sourceEtag &&
    checkpoint?.etag &&
    equivalentEtags(etag, checkpoint.etag)
  ) {
    return notModified({ ...checkpoint, etag }, firstResponse.headers);
  }

  const validator: SourceValidator = { etag };
  const lastModified = firstResponse.headers.get("last-modified");
  if (lastModified) validator.lastModified = lastModified;
  const fetched: SourceBody = {
    kind: "body",
    body,
    provenance: { sourceUrl: sourceUrl.toString() },
    completeness: partial ? "partial" : "complete",
    validator,
  };
  if (sourcePublishedAt) fetched.provenance.sourcePublishedAt = sourcePublishedAt;
  return fetched;
}

function validatedOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("BPstat API origin is invalid", "source-denied");
  }
  if (
    url.origin !== BPSTAT_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new GatekeeperError(`BPstat requests are restricted to ${BPSTAT_ORIGIN}`, "source-denied");
  }
  return url;
}

function datasetUrl(
  origin: URL,
  domain: string,
  dataset: string,
  lang: string,
  page?: number,
): URL {
  const url = new URL(
    `/data/v1/domains/${domain}/datasets/${dataset}/`,
    origin,
  );
  url.searchParams.set("lang", lang);
  if (page !== undefined) url.searchParams.set("page", String(page));
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

async function upstreamFetch(
  fetcher: typeof fetch,
  url: URL,
  headers: Headers,
): Promise<Response> {
  try {
    return await fetcher(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new GatekeeperError(`BPstat request failed${detail}`, "upstream-error");
  }
}

function requireSuccessfulResponse(response: Response): void {
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`BPstat returned HTTP ${response.status}`, "upstream-error");
  }
}

/**
 * One page of a paginated dataset. A page past the remaining budget is not a
 * failure while paging: collection stops there and reports a partial snapshot.
 */
async function readPage(response: Response, maximumBytes: number, allowPartial: boolean): Promise<Uint8Array | undefined> {
  try {
    return await readBoundedResponse(response, maximumBytes, "BPstat response");
  } catch (error) {
    if (allowPartial && error instanceof GatekeeperError && error.code === "response-too-large") return undefined;
    throw error;
  }
}

function parseDatasetPage(bytes: Uint8Array): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse("BPstat returned invalid JSON");
  }
  if (
    !isJsonObject(parsed) ||
    parsed.version !== "2.0" ||
    parsed.class !== "dataset" ||
    !Array.isArray(parsed.id) ||
    !parsed.id.every(nonEmptyString) ||
    !Array.isArray(parsed.size) ||
    !parsed.size.every(positiveInteger) ||
    parsed.id.length !== parsed.size.length ||
    !isJsonObject(parsed.dimension) ||
    (!Array.isArray(parsed.value) && !isJsonObject(parsed.value))
  ) {
    throw invalidResponse("BPstat response was not a JSON-stat 2.0 dataset");
  }
  const ids = parsed.id;
  const sizes = parsed.size;
  const dimensions = parsed.dimension;
  for (const [index, id] of ids.entries()) {
    const dimension = dimensions[id];
    const expectedSize = sizes[index];
    if (!isJsonObject(dimension) || !isJsonObject(dimension.category)) {
      throw invalidResponse(`BPstat dimension ${id} was malformed`);
    }
    validateCategoryIndex(dimension.category.index, expectedSize);
  }
  const role = isJsonObject(parsed.role) ? parsed.role : undefined;
  if (
    !role ||
    !Array.isArray(role.time) ||
    !role.time.some((id) => isJsonString(id) && ids.includes(id))
  ) {
    throw invalidResponse("BPstat dataset did not identify a time dimension");
  }
  const cellCount = sizes.reduce((product, size) => product * size, 1);
  if (!Number.isSafeInteger(cellCount)) {
    throw invalidResponse("BPstat dataset dimensions were too large to validate");
  }
  validateIndexedValues(parsed.value, cellCount, "value");
  if (parsed.status !== undefined) {
    validateIndexedValues(parsed.status, cellCount, "status");
  }
  return parsed;
}

function validateCategoryIndex(value: JsonValue | undefined, expectedSize: number | undefined): void {
  if (expectedSize === undefined) {
    throw invalidResponse("BPstat dimension size was missing");
  }
  if (Array.isArray(value)) {
    if (value.length !== expectedSize || !value.every(nonEmptyString)) {
      throw invalidResponse("BPstat dimension category index was malformed");
    }
    return;
  }
  if (!isJsonObject(value) || Object.keys(value).length !== expectedSize) {
    throw invalidResponse("BPstat dimension category index was malformed");
  }
  const positions = Object.values(value);
  if (
    !positions.every(
      (position) =>
        isJsonNumber(position) &&
        Number.isSafeInteger(position) &&
        position >= 0 &&
        position < expectedSize,
    ) ||
    new Set(positions).size !== expectedSize
  ) {
    throw invalidResponse("BPstat dimension category positions were malformed");
  }
}

function validateIndexedValues(
  value: JsonValue | undefined,
  cellCount: number,
  name: string,
): void {
  if (Array.isArray(value)) {
    if (value.length > cellCount) {
      throw invalidResponse(`BPstat ${name} exceeded the dataset dimensions`);
    }
    return;
  }
  if (
    !isJsonObject(value) ||
    Object.keys(value).some((key) => {
      if (!/^\d+$/.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= cellCount;
    })
  ) {
    throw invalidResponse(`BPstat ${name} sparse indexes were malformed`);
  }
}

function validateSelectedSeries(page: JsonObject, config: SourceConfig): void {
  if (!config.seriesIds) return;
  const requested = new Set(config.seriesIds.split(","));
  const series = isJsonObject(page.extension) ? page.extension.series : undefined;
  if (!Array.isArray(series) || series.some((item) => !isJsonObject(item) || !isJsonNumber(item.id) || !requested.has(String(item.id)))) {
    throw invalidResponse("BPstat returned series outside the requested selection");
  }
}

function validateDatasetIdentity(
  page: JsonObject,
  requestedUrl: URL,
  domain: string,
  dataset: string,
  lang: string,
): void {
  const href = optionalString(page.href);
  if (!href) return;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw invalidResponse("BPstat dataset returned an invalid href");
  }
  const expectedPath = `/data/v1/domains/${domain}/datasets/${dataset}/`;
  const actualPath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  if (
    url.origin !== BPSTAT_ORIGIN ||
    actualPath !== expectedPath ||
    url.searchParams.get("lang") !== lang ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw invalidResponse(
      `BPstat dataset identity did not match ${requestedUrl.toString()}`,
    );
  }
}

function nextPageNumber(
  page: JsonObject,
  sourceUrl: URL,
  currentPage: number,
): number | undefined {
  if (!isJsonObject(page.extension)) return undefined;
  const next = optionalString(page.extension.next_page);
  if (!next) return undefined;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    throw invalidResponse("BPstat returned an invalid next-page URL");
  }
  const expectedPath = sourceUrl.pathname;
  const actualPath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  const pageValues = url.searchParams.getAll("page");
  const langValues = url.searchParams.getAll("lang");
  const unknown = [...url.searchParams.keys()].filter(
    (key) => key !== "page" && (!sourceUrl.searchParams.has(key) || url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== sourceUrl.searchParams.get(key)),
  );
  const missingFilter = [...sourceUrl.searchParams.keys()].some((key) => key !== "page" && !url.searchParams.has(key));
  const pageNumber = Number(pageValues[0]);
  if (
    url.origin !== BPSTAT_ORIGIN ||
    actualPath !== expectedPath ||
    pageValues.length !== 1 ||
    langValues.length !== 1 ||
    langValues[0] !== sourceUrl.searchParams.get("lang") ||
    unknown.length > 0 || missingFilter ||
    !Number.isSafeInteger(pageNumber) ||
    pageNumber !== currentPage + 1
  ) {
    throw invalidResponse("BPstat returned an unsafe next-page URL");
  }
  return pageNumber;
}

function combinePages(pages: Uint8Array[]): Uint8Array {
  const prefix = new TextEncoder().encode('{"pages":[');
  const separator = new TextEncoder().encode(",");
  const suffix = new TextEncoder().encode("]}");
  const length =
    prefix.byteLength +
    suffix.byteLength +
    pages.reduce((sum, page) => sum + page.byteLength, 0) +
    Math.max(0, pages.length - 1) * separator.byteLength;
  const result = new Uint8Array(length);
  let offset = 0;
  result.set(prefix, offset);
  offset += prefix.byteLength;
  for (const [index, page] of pages.entries()) {
    if (index > 0) {
      result.set(separator, offset);
      offset += separator.byteLength;
    }
    result.set(page, offset);
    offset += page.byteLength;
  }
  result.set(suffix, offset);
  return result;
}

function sourcePublicationTime(
  page: JsonObject,
  headers: Headers,
): string | undefined {
  const extensionUpdate = isJsonObject(page.extension)
    ? optionalString(page.extension.obs_updated_at)
    : undefined;
  const updated = optionalString(page.updated);
  for (const candidate of [
    extensionUpdate,
    updated,
    headers.get("last-modified") ?? undefined,
  ]) {
    const normalized = isoDate(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

/** Upstream validators win; the checkpoint's fill in what an upstream 304 omits. */
function notModified(
  checkpoint: SourceValidator | undefined,
  upstreamHeaders: Headers,
): SourceNotModified {
  const validator: SourceValidator = {};
  const etag = upstreamHeaders.get("etag") ?? checkpoint?.etag;
  const lastModified =
    upstreamHeaders.get("last-modified") ?? checkpoint?.lastModified;
  if (etag) validator.etag = etag;
  if (lastModified) validator.lastModified = lastModified;
  const result: SourceNotModified = { kind: "not-modified" };
  if (etag || lastModified) result.validator = validator;
  return result;
}

function syntheticEtag(
  domain: string,
  dataset: string,
  lang: string,
  publishedAt: string,
): string {
  return `"bpstat:${domain}:${dataset}:${lang}:${publishedAt}"`;
}

function totalBytes(pages: Uint8Array[]): number {
  return pages.reduce((sum, page) => sum + page.byteLength, 0);
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function nonEmptyString(value: JsonValue | undefined): value is string {
  return isJsonString(value) && value.length > 0;
}

function positiveInteger(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isSafeInteger(value) && value > 0;
}


function tooLarge(): GatekeeperError {
  return new GatekeeperError(`BPstat response exceeded ${BPSTAT_MAX_BYTES} bytes`, "response-too-large");
}
