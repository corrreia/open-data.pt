import {
  GatekeeperError,
  hashString,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  streamJsonArray,
  type FeedKindDescription,
  type HistoryCursor,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceValidator,
  type SourceConfig,
} from "../../index";

export const MAX_METADATA_BYTES = 2 * 1024 * 1024;
/** One records page, and therefore also the largest single record accepted. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/**
 * History uses one export per time slice. Seven days of quarter-hour data is
 * about 120 KiB; a dimension-heavy SNS ten-year monthly slice is about 1.8
 * MiB. Dense monthly cross-tabs (self-consumption per parish, technology and
 * power band) exceed 2 MiB for a single month; 6 MiB stays under the 8 MiB
 * policies. A slice is buffered because it is sorted and cut at a timestamp.
 */
export const MAX_HISTORY_DOCUMENT_BYTES = 6 * 1024 * 1024;
export const HISTORY_SLICE_SECONDS = 7 * 24 * 60 * 60;
export const MAX_HISTORY_RECORDS = 2_000;
const DEFAULT_RECORD_LIMIT = 10_000;
const PAGE_SIZE = 100;
const DATASET_PATTERN = /^[a-z0-9_-]+$/;
const ODSQL_PATTERN = /^[\w\s=<>!'"(),.:-]+$/;
const CONFIG_KEYS = new Set(["host", "dataset", "where", "select", "orderBy", "limit", "series"]);
/** A field named in `series`: Opendatasoft field names are lowercase identifiers. */
const SERIES_FIELD_PATTERN = /^[a-z0-9_]{1,128}$/;

export const OPENDATASOFT_FEEDS = {
  dataset: {
    kind: "dataset",
    title: "Opendatasoft dataset",
    description: "A bounded Opendatasoft Explore dataset snapshot, with geospatial fields and numeric series inferred from its published schema.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
    // The concrete span is precision-dependent (7 days, 365 days, or 10
    // calendar years); this is the conservative minimum advertised statically.
    history: {},
  },
} as const satisfies Record<string, FeedKindDescription>;

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface ValidatedConfig {
  host: string;
  dataset: string;
  where?: string;
  select?: string;
  orderBy?: string;
  limit: number;
}

interface DatasetMetadata extends JsonObject {
  dataset_id: string;
  fields: Array<JsonObject>;
  metas: JsonObject & { default: JsonObject };
}

/** The records array of a paged collection, and whether it reaches the dataset's end. */
interface PagedRecords {
  bytes: AsyncGenerator<Uint8Array>;
  complete: boolean;
}

export function validateOpendatasoftFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new GatekeeperError(`Unknown Opendatasoft configuration field: ${key}`, "invalid-config");
    }
  }

  const host = config.host?.trim().toLowerCase();
  const dataset = config.dataset?.trim().toLowerCase();
  if (!host || !dataset) {
    throw new GatekeeperError("Opendatasoft sources require host and dataset", "invalid-config");
  }
  if (!isHostname(host)) {
    throw new GatekeeperError("host must be a hostname without a scheme, path, port, or credentials", "invalid-config");
  }
  if (!hosts.has(host)) {
    throw new GatekeeperError(`Source host ${host} is not allowed`, "source-denied");
  }
  if (!DATASET_PATTERN.test(dataset)) {
    throw new GatekeeperError("dataset must match ^[a-z0-9_-]+$", "invalid-config");
  }

  const normalized: SourceConfig = { host, dataset };
  for (const key of ["where", "select", "orderBy"] as const) {
    const value = config[key]?.trim();
    if (value !== undefined && value !== "") {
      if (value.length > 500 || !ODSQL_PATTERN.test(value)) {
        throw new GatekeeperError(`${key} contains unsupported ODSQL characters`, "invalid-config");
      }
      normalized[key] = value;
    }
  }

  const series = config.series?.trim();
  if (series !== undefined && series !== "") {
    const names = series.split(",").map((name) => name.trim());
    if (names.length > 32 || names.some((name) => !SERIES_FIELD_PATTERN.test(name))) {
      throw new GatekeeperError("series must be up to 32 comma-separated field names", "invalid-config");
    }
    normalized.series = names.join(",");
  }

  const limitText = config.limit?.trim() ?? String(DEFAULT_RECORD_LIMIT);
  if (!/^\d+$/.test(limitText)) {
    throw new GatekeeperError("limit must be an integer between 1 and 10000", "invalid-config");
  }
  const limit = Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_RECORD_LIMIT) {
    throw new GatekeeperError("limit must be an integer between 1 and 10000", "invalid-config");
  }
  normalized.limit = String(limit);
  return normalized;
}

export class OpendatasoftSource {
  constructor(
    private readonly allowedHosts: ReadonlySet<string>,
    private readonly fetcher: Fetcher,
  ) {}

  validateConfig(config: SourceConfig): SourceConfig {
    return validateOpendatasoftFeedConfig(config, this.allowedHosts);
  }

  /**
   * The live snapshot as `{"dataset": <metadata>, "records": [...]}`, streamed:
   * metadata first, then either the export array piped through as it arrives,
   * or the records endpoint's pages fetched one after another as the body is
   * read. Completeness is known before any record: the export holds the whole
   * selection, and paging stops at `limit`, which the first page's
   * `total_count` compares against.
   */
  async collect(
    config: SourceConfig,
    checkpoint?: SourceValidator,
  ): Promise<SourceFetch> {
    const validated = parseValidated(this.validateConfig(config));
    const datasetUrl = datasetEndpoint(validated);
    const metadataResponse = await this.fetcher(datasetUrl, { headers: conditionalHeaders(checkpoint) });

    if (metadataResponse.status === 304) {
      return notModified(metadataResponse.headers, checkpoint);
    }
    assertUpstreamResponse(metadataResponse, "metadata");
    const metadata = parseDatasetMetadata(
      await readBoundedResponse(metadataResponse, MAX_METADATA_BYTES, "Opendatasoft metadata"),
      validated.dataset,
    );
    const publication = publicationTime(metadata);
    const validator: SourceValidator = { etag: syntheticEtag(metadata) };
    if (publication) validator.lastModified = new Date(publication).toUTCString();
    if (
      checkpoint?.etag === validator.etag ||
      (checkpoint?.lastModified !== undefined && checkpoint.lastModified === validator.lastModified)
    ) {
      return { kind: "not-modified", validator };
    }

    const provenance: SourceBody["provenance"] = { sourceUrl: datasetUrl.toString() };
    if (publication) provenance.sourcePublishedAt = publication;
    if (datasetRecordCount(metadata) <= validated.limit) {
      const records = await this.openExport(validated);
      return { kind: "body", body: capturedDocument(metadata, records), provenance, completeness: "complete", validator };
    }
    const paged = await this.openPages(validated, metadata);
    return {
      kind: "body",
      body: capturedDocument(metadata, paged.bytes),
      provenance,
      completeness: paged.complete ? "complete" : "partial",
      validator,
    };
  }

  /**
   * Collect one exclusive, backwards-moving time slice. Precision annotations
   * select seven days for minute/hour data, 365 days for daily data, and ten
   * calendar years for monthly/yearly data. There is deliberately no internal
   * page loop: metadata, one cheap earliest-row boundary query, and one export.
   */
  async collectHistory(
    config: SourceConfig,
    cursor: HistoryCursor,
  ): Promise<SourceFetch> {
    const validated = parseValidated(this.validateConfig(config));
    const before = parseHistoryCursor(cursor);
    const datasetUrl = datasetEndpoint(validated);
    const metadataResponse = await this.fetcher(datasetUrl, {
      headers: { Accept: "application/json" },
    });
    assertUpstreamResponse(metadataResponse, "metadata");
    const metadata = parseDatasetMetadata(
      await readBoundedResponse(metadataResponse, MAX_METADATA_BYTES, "Opendatasoft metadata"),
      validated.dataset,
    );
    const timeField = historyTimeField(metadata);
    // Without an annotated time field there is no older slice to walk.
    if (!timeField) return { kind: "exhausted" };

    const earliestUrl = recordsEndpoint(validated);
    if (validated.where) earliestUrl.searchParams.set("where", validated.where);
    earliestUrl.searchParams.set("order_by", timeField.name);
    earliestUrl.searchParams.set("limit", "1");
    const earliestResponse = await this.fetcher(earliestUrl, {
      headers: { Accept: "application/json" },
    });
    assertUpstreamResponse(earliestResponse, "earliest record");
    const earliestPage = parseRecordsPage(
      await readBoundedResponse(earliestResponse, MAX_PAGE_BYTES, "Opendatasoft earliest record"),
      "earliest record",
    );
    const firstRow = earliestPage.results[0];
    if (!firstRow) return { kind: "exhausted" };
    const earliest = historyEventTime(firstRow[timeField.name], timeField.type);
    if (!earliest) {
      throw new GatekeeperError(`Opendatasoft earliest record has no valid ${timeField.name} value`, "invalid-response");
    }
    if (earliest >= before) return { kind: "exhausted" };
    if (cursor.offset !== undefined) {
      return this.collectDenseHistory(validated, metadata, timeField, before, cursor.offset, cursor.token);
    }

    const plannedFrom = historySliceFrom(before, timeField.precision);
    let from = plannedFrom < earliest ? earliest : plannedFrom;
    let exportUrl!: URL;
    let value: JsonValue;
    // Dense datasets (monthly rows per parish and technology) can exceed the
    // document cap over a planned span; halve the span until the export fits.
    for (let attempt = 0; ; attempt += 1) {
      exportUrl = new URL(
        `/api/explore/v2.1/catalog/datasets/${encodeURIComponent(validated.dataset)}/exports/json`,
        `https://${validated.host}`,
      );
      const timeWhere = `${timeField.name} >= '${historyLiteral(from, timeField.type)}' AND ${timeField.name} < '${historyLiteral(before, timeField.type)}'`;
      exportUrl.searchParams.set(
        "where",
        validated.where ? `(${validated.where}) AND ${timeWhere}` : timeWhere,
      );
      exportUrl.searchParams.set("order_by", `${timeField.name} DESC`);
      const exportResponse = await this.fetcher(exportUrl, {
        headers: { Accept: "application/json" },
      });
      assertUpstreamResponse(exportResponse, "history export");
      try {
        value = parseResource(
          await readBoundedResponse(exportResponse, MAX_HISTORY_DOCUMENT_BYTES, "Opendatasoft history export"),
          "history export",
        );
        break;
      } catch (error) {
        const tooLarge = error instanceof GatekeeperError && error.code === "response-too-large";
        if (!tooLarge) throw error;
        const span = Date.parse(before) - Date.parse(from);
        if (attempt >= 8 || span <= 24 * 60 * 60 * 1000) {
          // Even one day does not fit: the dataset is a cross-tab with many
          // rows per timestamp. Walk it one timestamp at a time, by rows.
          return this.collectDenseHistory(validated, metadata, timeField, before, 0);
        }
        from = new Date(Date.parse(before) - Math.floor(span / 2)).toISOString();
      }
    }
    if (!Array.isArray(value) || !value.every(isJsonObject)) {
      throw new GatekeeperError("Opendatasoft history export returned an unexpected shape", "invalid-response");
    }

    const exportedRecords = value.filter(isJsonObject);
    if (exportedRecords.length === 0) {
      if (from === earliest) return { kind: "exhausted" };
      return historyBody(historyDocument(metadata, exportedRecords), exportUrl, from);
    }
    const candidates = exportedRecords.map((record) => {
      const eventTime = historyEventTime(record[timeField.name], timeField.type);
      if (!eventTime || eventTime < from || eventTime >= before) {
        throw new GatekeeperError(`Opendatasoft history export contains an invalid or out-of-range ${timeField.name} value`, "invalid-response");
      }
      return { eventTime, record };
    }).sort((left, right) => right.eventTime.localeCompare(left.eventTime));
    // Dense monthly datasets can put several thousand dimensional rows in a
    // ten-year export. Cap the returned slice while retaining every row tied
    // at the cutoff timestamp; the next exclusive cursor therefore loses none.
    const cutoff = candidates[Math.min(candidates.length, MAX_HISTORY_RECORDS) - 1]?.eventTime;
    const selected = cutoff
      ? candidates.filter((candidate) => candidate.eventTime >= cutoff)
      : candidates;
    const records = selected.map((candidate) => candidate.record);
    const oldest = selected.at(-1)?.eventTime;
    if (!oldest || oldest >= before) {
      throw new GatekeeperError("Opendatasoft history cursor did not move backwards", "invalid-response");
    }
    return historyBody(historyDocument(metadata, records), exportUrl, oldest > earliest ? oldest : undefined);
  }

  /**
   * Partitioned history for datasets with more rows per timestamp than a
   * document holds (monthly cross-tabs by parish, technology and power band).
   * The latest timestamp below the cursor is split by a facet field with
   * between two and a hundred values (district codes, say); one slice is as
   * many of those partitions as fit, exported with `where`. The next cursor
   * keeps the same `before` with the next partition index until the
   * timestamp is exhausted, then moves `before` down to it. Rows share one
   * timestamp, so the kernel treats offset continuations as inclusive of
   * the floor. Offsets beyond 10,000 are never used: Opendatasoft rejects them.
   */
  private async collectDenseHistory(
    validated: ValidatedConfig,
    metadata: DatasetMetadata,
    timeField: { name: string; type: string; precision: string },
    before: string,
    offset: number,
    token?: string,
  ): Promise<SourceFetch> {
    const timeWhere = (extra?: string) => {
      const base = `${timeField.name} < '${historyLiteral(before, timeField.type)}'${extra ? ` AND ${extra}` : ""}`;
      return validated.where ? `(${validated.where}) AND ${base}` : base;
    };
    const latestUrl = recordsEndpoint(validated);
    latestUrl.searchParams.set("where", timeWhere());
    latestUrl.searchParams.set("order_by", `${timeField.name} DESC`);
    latestUrl.searchParams.set("limit", "1");
    const latestResponse = await this.fetcher(latestUrl, { headers: { Accept: "application/json" } });
    assertUpstreamResponse(latestResponse, "latest history record");
    const latestPage = parseRecordsPage(await readBoundedResponse(latestResponse, MAX_PAGE_BYTES, "Opendatasoft latest history record"), "latest history record");
    const latestRow = latestPage.results[0];
    if (!latestRow) return { kind: "exhausted" };
    const stamp = historyEventTime(latestRow[timeField.name], timeField.type);
    if (!stamp) {
      throw new GatekeeperError(`Opendatasoft history record has no valid ${timeField.name} value`, "invalid-response");
    }
    const stampWhere = timeWhere(`${timeField.name} >= '${historyLiteral(stamp, timeField.type)}'`);

    // A facet that splits this timestamp into 2..100 partitions. A continuation
    // names the field it used; otherwise take the first text field that fits.
    const fields = metadata.fields
      .filter((field) => field.type === "text" && isJsonString(field.name) && DATASET_PATTERN.test(String(field.name)) && field.name !== timeField.name)
      .map((field) => String(field.name));
    const candidates = token && fields.includes(token) ? [token] : fields.slice(0, 6);
    let partitionField: string | undefined;
    let values: string[] = [];
    for (const name of candidates) {
      if (partitionField) break;
      const facetsUrl = new URL(`/api/explore/v2.1/catalog/datasets/${encodeURIComponent(validated.dataset)}/facets`, `https://${validated.host}`);
      facetsUrl.searchParams.set("facet", name);
      facetsUrl.searchParams.set("where", stampWhere);
      const response = await this.fetcher(facetsUrl, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const parsed = parseResource(await readBoundedResponse(response, MAX_PAGE_BYTES, "Opendatasoft facets"), "facets");
      const group = isJsonObject(parsed) && Array.isArray(parsed.facets) ? parsed.facets.find((entry) => isJsonObject(entry) && entry.name === name) : undefined;
      const found = isJsonObject(group) && Array.isArray(group.facets)
        ? group.facets.flatMap((entry) => (isJsonObject(entry) && isJsonString(entry.value) ? [entry.value] : []))
        : [];
      if (found.length >= 2 && found.length <= 100 && (values.length === 0 || found.length > values.length)) {
        partitionField = name;
        values = [...new Set(found)].sort();
      }
    }
    if (!partitionField) {
      throw new GatekeeperError("Opendatasoft dataset has no facet that partitions a timestamp into at most 100 slices", "invalid-response");
    }
    if (offset >= values.length) {
      // Every partition of this timestamp was already delivered: move down.
      return historyBody(historyDocument(metadata, []), latestUrl, stamp);
    }

    const records: Array<JsonObject> = [];
    let aggregateBytes = new TextEncoder().encode(JSON.stringify({ dataset: metadata, records: [] })).byteLength;
    let index = offset;
    let lastUrl = latestUrl;
    while (index < values.length) {
      const exportUrl = new URL(`/api/explore/v2.1/catalog/datasets/${encodeURIComponent(validated.dataset)}/exports/json`, `https://${validated.host}`);
      exportUrl.searchParams.set("where", `${stampWhere} AND ${partitionField} = '${values[index]!.replaceAll("'", "''")}'`);
      exportUrl.searchParams.set("order_by", `${timeField.name} DESC`);
      const response = await this.fetcher(exportUrl, { headers: { Accept: "application/json" } });
      assertUpstreamResponse(response, "history partition export");
      const value = parseResource(await readBoundedResponse(response, MAX_HISTORY_DOCUMENT_BYTES, "Opendatasoft history partition export"), "history partition export");
      if (!Array.isArray(value) || !value.every(isJsonObject)) {
        throw new GatekeeperError("Opendatasoft history partition returned an unexpected shape", "invalid-response");
      }
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (records.length > 0 && (aggregateBytes + bytes > MAX_HISTORY_DOCUMENT_BYTES || records.length + value.length > MAX_HISTORY_RECORDS)) break;
      records.push(...value.filter(isJsonObject));
      aggregateBytes += bytes;
      lastUrl = exportUrl;
      index += 1;
      if (aggregateBytes > MAX_HISTORY_DOCUMENT_BYTES / 2 || records.length >= MAX_HISTORY_RECORDS) break;
    }
    const exhausted = index >= values.length;
    return {
      kind: "body",
      body: historyDocument(metadata, records),
      provenance: { sourceUrl: lastUrl.toString() },
      completeness: "complete",
      next: exhausted ? { before: stamp } : { before, offset: index, token: partitionField },
    };
  }

  private async openExport(config: ValidatedConfig): Promise<AsyncGenerator<Uint8Array>> {
    const endpoint = new URL(
      `/api/explore/v2.1/catalog/datasets/${encodeURIComponent(config.dataset)}/exports/json`,
      `https://${config.host}`,
    );
    addQuery(endpoint, config, true);
    const response = await this.fetcher(endpoint, {
      headers: { Accept: "application/json" },
    });
    return byteChunks(upstreamBody(response, "export"));
  }

  private async openPages(
    config: ValidatedConfig,
    metadata: DatasetMetadata,
  ): Promise<PagedRecords> {
    const orderBy = config.orderBy ?? defaultOrderBy(metadata);
    const first = await this.openPage(config, orderBy, 0);
    const head = await first.elements.next();
    const totalCount = first.envelope().total_count;
    if (!isJsonNumber(totalCount) || !Number.isSafeInteger(totalCount) || totalCount < 0) {
      await first.elements.return?.(undefined);
      throw new GatekeeperError("Opendatasoft records endpoint omitted total_count", "invalid-response");
    }
    return {
      bytes: arrayBytes(this.pagedRecords(config, orderBy, first.elements, head, totalCount)),
      complete: totalCount <= config.limit,
    };
  }

  /** Records from consecutive pages, the next page requested only once the previous one is read. */
  private async *pagedRecords(
    config: ValidatedConfig,
    orderBy: string,
    firstPage: AsyncIterator<JsonValue>,
    head: IteratorResult<JsonValue>,
    totalCount: number,
  ): AsyncGenerator<JsonObject> {
    const target = Math.min(config.limit, totalCount);
    let elements = firstPage;
    let next = head;
    let emitted = 0;
    let pageRows = 0;
    try {
      while (emitted < target) {
        if (next.done) {
          if (pageRows === 0) return;
          elements = (await this.openPage(config, orderBy, emitted)).elements;
          next = await elements.next();
          pageRows = 0;
          continue;
        }
        if (!isJsonObject(next.value)) {
          throw new GatekeeperError("Opendatasoft records endpoint returned an unexpected shape", "invalid-response");
        }
        yield next.value;
        emitted += 1;
        pageRows += 1;
        if (emitted < target) next = await elements.next();
      }
    } finally {
      await elements.return?.(undefined);
    }
  }

  private async openPage(config: ValidatedConfig, orderBy: string, offset: number): Promise<RecordsPageStream> {
    const endpoint = recordsEndpoint(config);
    addQuery(endpoint, config, true);
    endpoint.searchParams.set("order_by", orderBy);
    endpoint.searchParams.set("limit", String(Math.min(PAGE_SIZE, config.limit - offset)));
    endpoint.searchParams.set("offset", String(offset));
    const response = await this.fetcher(endpoint, {
      headers: { Accept: "application/json" },
    });
    const page = streamJsonArray(upstreamBody(response, "records"), ["results"], { maxElementBytes: MAX_PAGE_BYTES });
    return { envelope: () => page.envelope(), elements: page.elements[Symbol.asyncIterator]() };
  }
}

/** One records page being read element by element. */
interface RecordsPageStream {
  envelope(): JsonObject;
  elements: AsyncIterator<JsonValue>;
}

/** `{"dataset": <metadata>, "records": <array>}`, with the array's bytes supplied as they are read. */
function capturedDocument(metadata: DatasetMetadata, records: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  async function* parts(): AsyncGenerator<Uint8Array> {
    yield encoder.encode(`{"dataset":${JSON.stringify(metadata)},"records":`);
    yield* records;
    yield encoder.encode("}");
  }
  const iterator = parts();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

async function* arrayBytes(values: AsyncGenerator<JsonObject>): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let separator = "";
  yield encoder.encode("[");
  for await (const value of values) {
    yield encoder.encode(`${separator}${JSON.stringify(value)}`);
    separator = ",";
  }
  yield encoder.encode("]");
}

async function* byteChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let finished = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      yield part.value;
    }
    finished = true;
  } finally {
    if (!finished) await reader.cancel("Opendatasoft body closed early").catch(() => undefined);
    reader.releaseLock();
  }
}

function parseValidated(config: SourceConfig): ValidatedConfig {
  const validated: ValidatedConfig = {
    host: config.host ?? "",
    dataset: config.dataset ?? "",
    limit: Number(config.limit),
  };
  if (config.where) validated.where = config.where;
  if (config.select) validated.select = config.select;
  if (config.orderBy) validated.orderBy = config.orderBy;
  return validated;
}

function isHostname(value: string): boolean {
  try {
    const url = new URL(`https://${value}`);
    return (
      url.hostname === value &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}

function datasetEndpoint(config: ValidatedConfig): URL {
  return new URL(
    `/api/explore/v2.1/catalog/datasets/${encodeURIComponent(config.dataset)}`,
    `https://${config.host}`,
  );
}

function recordsEndpoint(config: ValidatedConfig): URL {
  return new URL(
    `/api/explore/v2.1/catalog/datasets/${encodeURIComponent(config.dataset)}/records`,
    `https://${config.host}`,
  );
}

function addQuery(endpoint: URL, config: ValidatedConfig, includeOrder: boolean): void {
  if (config.where) endpoint.searchParams.set("where", config.where);
  if (config.select) endpoint.searchParams.set("select", config.select);
  if (includeOrder && config.orderBy) endpoint.searchParams.set("order_by", config.orderBy);
}

function conditionalHeaders(checkpoint?: SourceValidator): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (checkpoint?.etag) headers.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) headers.set("If-Modified-Since", checkpoint.lastModified);
  return headers;
}

function assertUpstreamResponse(response: Response, resource: string): void {
  if (!response.ok) throw upstreamError(response, resource);
}

function upstreamBody(response: Response, resource: string): ReadableStream<Uint8Array> {
  assertUpstreamResponse(response, resource);
  if (!response.body) {
    throw new GatekeeperError(`Opendatasoft ${resource} returned an empty response`, "invalid-response");
  }
  return response.body;
}

function upstreamError(response: Response, resource: string): GatekeeperError {
  return new GatekeeperError(`Opendatasoft ${resource} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
}

function parseResource(bytes: Uint8Array, resource: string): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`Opendatasoft ${resource} returned invalid JSON`, "invalid-response");
  }
}

function parseDatasetMetadata(bytes: Uint8Array, dataset: string): DatasetMetadata {
  const value = parseResource(bytes, "metadata");
  if (
    !isJsonObject(value) ||
    value.dataset_id !== dataset ||
    !Array.isArray(value.fields) ||
    !value.fields.every(isJsonObject) ||
    !isJsonObject(value.metas) ||
    !isJsonObject(value.metas.default)
  ) {
    throw new GatekeeperError("Opendatasoft metadata returned an unexpected dataset shape", "invalid-response");
  }
  // SAFETY: the checks above confirm every field DatasetMetadata names —
  // dataset_id a string, fields an array of objects, metas.default an object.
  const metadata = value as DatasetMetadata;
  datasetRecordCount(metadata);
  return metadata;
}

function datasetRecordCount(metadata: DatasetMetadata): number {
  const count = metadata.metas.default.records_count;
  if (!isJsonNumber(count) || !Number.isSafeInteger(count) || count < 0) {
    throw new GatekeeperError("Opendatasoft metadata omitted records_count", "invalid-response");
  }
  return count;
}

interface HistoryTimeField {
  name: string;
  type: string;
  precision: string;
}

function historyTimeField(metadata: DatasetMetadata): HistoryTimeField | undefined {
  for (const field of metadata.fields) {
    if (
      isJsonString(field.name) &&
      DATASET_PATTERN.test(field.name) &&
      isJsonString(field.type) &&
      isJsonObject(field.annotations) &&
      isJsonString(field.annotations.timeserie_precision)
    ) {
      return {
        name: field.name,
        type: field.type,
        precision: field.annotations.timeserie_precision.toLowerCase(),
      };
    }
  }
  return undefined;
}

function parseHistoryCursor(cursor: HistoryCursor): string {
  if (!isJsonString(cursor.before) || cursor.before.trim() === "") {
    throw new GatekeeperError("History cursor.before must be an ISO 8601 date", "invalid-config");
  }
  const milliseconds = Date.parse(cursor.before);
  if (Number.isNaN(milliseconds)) {
    throw new GatekeeperError("History cursor.before must be an ISO 8601 date", "invalid-config");
  }
  return new Date(milliseconds).toISOString();
}

function historySliceFrom(before: string, precision: string): string {
  const date = new Date(before);
  if (precision === "month" || precision === "year") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() - 10);
    const lastDay = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString();
  }
  const days = precision === "day" ? 365 : 7;
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function historyLiteral(value: string, type: string): string {
  return type === "date" ? value.slice(0, 10) : value.replace(/\.000Z$/, "Z");
}

function historyEventTime(value: JsonValue | undefined, type: string): string | undefined {
  if (!isJsonString(value) || value.trim() === "") return undefined;
  const text = value.trim();
  let timestamp = text;
  if (/^\d{4}$/.test(text)) timestamp = `${text}-01-01T00:00:00Z`;
  else if (/^\d{4}-\d{2}$/.test(text)) timestamp = `${text}-01T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) timestamp = `${text}T00:00:00Z`;
  else if (
    type === "datetime" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)
  ) timestamp = `${text}Z`;
  const milliseconds = Date.parse(timestamp);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}

/** One page of records as the Explore API returns it. */
interface RecordsPage {
  totalCount: number;
  results: Array<JsonObject>;
}

function parseRecordsPage(bytes: Uint8Array, resource: string): RecordsPage {
  const value = parseResource(bytes, resource);
  if (
    !isJsonObject(value) ||
    !isJsonNumber(value.total_count) ||
    !Number.isFinite(value.total_count) ||
    !Array.isArray(value.results) ||
    !value.results.every(isJsonObject)
  ) {
    throw new GatekeeperError(`Opendatasoft ${resource} returned an unexpected shape`, "invalid-response");
  }
  return { totalCount: value.total_count, results: value.results.filter(isJsonObject) };
}

function historyDocument(
  metadata: DatasetMetadata,
  records: Array<JsonObject>,
): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify({ dataset: metadata, records }));
  if (bytes.byteLength > MAX_HISTORY_DOCUMENT_BYTES) {
    throw new GatekeeperError(`Opendatasoft history document exceeds ${MAX_HISTORY_DOCUMENT_BYTES} bytes`, "response-too-large");
  }
  return bytes;
}

function historyBody(body: Uint8Array, sourceUrl: URL, nextBefore?: string): SourceBody {
  const fetched: SourceBody = {
    kind: "body",
    body,
    provenance: { sourceUrl: sourceUrl.toString() },
    completeness: "complete",
  };
  // Only a slice without a next bound has reached the configured earliest period.
  if (nextBefore) fetched.next = { before: nextBefore };
  else fetched.exhausted = true;
  return fetched;
}

function publicationTime(metadata: DatasetMetadata): string | undefined {
  for (const value of [metadata.metas.default.data_processed, metadata.metas.default.modified]) {
    if (!isJsonString(value)) continue;
    const milliseconds = Date.parse(value);
    if (!Number.isNaN(milliseconds)) return new Date(milliseconds).toISOString();
  }
  return undefined;
}

function syntheticEtag(metadata: DatasetMetadata): string {
  const basis = [
    metadata.metas.default.modified,
    metadata.metas.default.data_processed,
    metadata.metas.default.records_count,
  ].map(String).join("|");
  return `"ods-${hashString(basis)}"`;
}

function defaultOrderBy(metadata: DatasetMetadata): string {
  const sortable = metadata.fields.find(
    (field) => isJsonObject(field.annotations) && field.annotations.sortable === true,
  );
  const first = sortable ?? metadata.fields[0];
  if (!first || !isJsonString(first.name) || !DATASET_PATTERN.test(first.name)) {
    throw new GatekeeperError("Opendatasoft metadata has no field suitable for deterministic pagination", "invalid-response");
  }
  return first.name;
}

/** An upstream 304: keep the validators it restates, or the ones the checkpoint sent. */
function notModified(upstreamHeaders: Headers, checkpoint?: SourceValidator): SourceFetch {
  const validator: SourceValidator = {};
  const etag = upstreamHeaders.get("etag") ?? checkpoint?.etag;
  const lastModified = upstreamHeaders.get("last-modified") ?? checkpoint?.lastModified;
  if (etag) validator.etag = etag;
  if (lastModified) validator.lastModified = lastModified;
  return etag || lastModified ? { kind: "not-modified", validator } : { kind: "not-modified" };
}
