import {
  GatekeeperError,
  invalidResponse,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  optionalString,
  parseJsonBytes,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  streamJsonArray,
  type Completeness,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceNotModified,
  type SourceProvenance,
  type SourceValidator,
  type SourceConfig,
} from "../../index";

import { CKAN_NORMALIZER } from "./transform";
export const CKAN_FEEDS = {
  resource: {
    kind: "resource",
    title: "CKAN resource",
    description: "One CSV, JSON, or GeoJSON resource from a CKAN dataset.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export const CKAN_LIMITS = {
  metadataBytes: 2 * 1024 * 1024,
  /** Records asked of one datastore_search request. */
  datastorePageRows: 1_000,
  /** datastore_search requests one collection may make; a larger table is collected as a partial snapshot. */
  datastorePages: 100,
} as const;

/** Largest single DataStore record; the table itself streams, unbounded by memory. */
const DATASTORE_RECORD_BYTES = 4 * 1024 * 1024;

const DATASET_PATTERN = /^[a-z0-9_-]+$/;
const RESOURCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_FORMATS = new Set(["csv", "json", "geojson"]);

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Where the rows of a collected resource come from, which decides how the body is read. */
export type CkanRowSource =
  | { kind: "datastore"; fields: JsonValue[] }
  | { kind: "file"; format: "csv" | "json" | "geojson" };

/** What the transform needs besides the body: the package and resource it describes. */
export interface CkanResourceMetadata {
  package: JsonObject;
  resource: JsonObject;
  source: CkanRowSource;
}

/** A source fetch, and the metadata that describes its body when there is one. */
export interface CkanCollected {
  fetch: SourceFetch;
  metadata?: CkanResourceMetadata;
}

interface SelectedResource {
  metadata: JsonObject;
  id: string;
  url: string;
  format: "csv" | "json" | "geojson";
  datastoreActive: boolean;
}

type DatastoreResult =
  | { kind: "rows"; fields: JsonValue[]; completeness: Completeness; sourceUrl: string; body: ReadableStream<Uint8Array> }
  | { kind: "not-modified" }
  | { kind: "unavailable" };

/** One datastore_search page being read record by record. */
interface DatastorePage {
  records: AsyncIterator<JsonValue>;
  envelope: () => JsonObject;
  count: number;
}

export function validateCkanFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  const host = config.host?.trim().toLowerCase();
  const dataset = config.dataset?.trim();
  const resource = config.resource?.trim().toLowerCase();

  if (!host || !dataset) {
    throw new GatekeeperError("CKAN resources require host and dataset", "invalid-config");
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) {
    throw new GatekeeperError("host must be a hostname", "invalid-config");
  }
  if (!hosts.has(host)) {
    throw new GatekeeperError(`Source host ${host} is not allowed`, "source-denied");
  }
  if (!DATASET_PATTERN.test(dataset)) {
    throw new GatekeeperError("dataset must match ^[a-z0-9_-]+$", "invalid-config");
  }
  if (resource && !RESOURCE_PATTERN.test(resource)) {
    throw new GatekeeperError("resource must be a UUID", "invalid-config");
  }

  const validated: SourceConfig = { host, dataset };
  if (resource) validated.resource = resource;
  return validated;
}

export class CkanSource {
  constructor(
    private readonly allowedHosts: ReadonlySet<string>,
    private readonly fetcher: Fetcher,
  ) {}

  validateConfig(config: SourceConfig): SourceConfig {
    return validateCkanFeedConfig(config, this.allowedHosts);
  }

  /**
   * Resolve the resource from package_show, then hand back its rows as a
   * stream: the DataStore table page by page when it has one, otherwise the
   * declared file as the publisher serves it. Nothing is buffered whole.
   */
  async collect(
    config: SourceConfig,
    checkpoint?: SourceValidator,
  ): Promise<CkanCollected> {
    const validated = this.validateConfig(config);
    const origin = `https://${validated.host!}`;
    const packageUrl = actionUrl(origin, "package_show", {
      id: validated.dataset!,
    });
    const packageResponse = await this.fetchAllowed(packageUrl, {
      headers: { Accept: "application/json" },
    });
    if (!packageResponse.ok) {
      throw upstreamError("package_show", packageResponse);
    }
    const packageEnvelope = parseActionEnvelope(
      await readBoundedResponse(packageResponse, CKAN_LIMITS.metadataBytes, "CKAN package metadata"),
      "package_show",
    );
    const packageResult = requireActionResult(packageEnvelope, "package_show");
    const resource = selectResource(packageResult, validated.resource);
    const publishedAt = sourcePublishedAt(resource.metadata, packageResult);
    const validator: SourceValidator = {};
    if (publishedAt) {
      // The normalizer version is part of the tag, so a changed normalizer reads every resource once more.
      validator.etag = `"ckan:${CKAN_NORMALIZER.version}:${resource.id}:${publishedAt}"`;
      validator.lastModified = new Date(publishedAt).toUTCString();
    }

    if (checkpointMatches(checkpoint, validator.etag, validator.lastModified)) {
      return { fetch: notModified(validator) };
    }

    const packageDocument = compactPackage(packageResult);
    if (resource.datastoreActive) {
      const datastore = await this.collectDatastore(origin, resource.id, checkpoint);
      if (datastore.kind === "not-modified") return { fetch: notModified(validator) };
      if (datastore.kind === "rows") {
        return {
          fetch: sourceBody(datastore.body, datastore.sourceUrl, publishedAt, datastore.completeness, validator),
          metadata: {
            package: packageDocument,
            resource: resource.metadata,
            source: { kind: "datastore", fields: datastore.fields },
          },
        };
      }
      // Some CKAN catalogs retain datastore_active=true after removing the
      // DataStore table. A Not Found action response is the one safe fallback:
      // download the resource URL already declared by package_show.
    }

    const fileUrl = validateResourceUrl(resource.url, this.allowedHosts);
    const fileResponse = await this.fetchAllowed(fileUrl, {
      headers: conditionalHeaders(checkpoint, "*/*"),
    });
    if (fileResponse.status === 304) return { fetch: notModified(validator) };
    if (!fileResponse.ok) {
      throw upstreamError("resource download", fileResponse);
    }
    if (!fileResponse.body) {
      throw invalidResponse("CKAN resource returned an empty body");
    }
    // Without a catalogue timestamp, the publisher's own validators are the
    // only way to ask for the file conditionally next time.
    const fileValidator = Object.keys(validator).length > 0
      ? validator
      : responseValidator(fileResponse.headers) ?? {};
    return {
      fetch: sourceBody(fileResponse.body, resource.url, publishedAt, "complete", fileValidator),
      metadata: {
        package: packageDocument,
        resource: resource.metadata,
        source: { kind: "file", format: resource.format },
      },
    };
  }

  /**
   * Ask the DataStore for the table's fields and total alone, so completeness
   * is known before the first row; the records then stream page by page.
   */
  private async collectDatastore(
    origin: string,
    resourceId: string,
    checkpoint: SourceValidator | undefined,
  ): Promise<DatastoreResult> {
    const probe = actionUrl(origin, "datastore_search", {
      resource_id: resourceId,
      limit: "0",
    });
    const response = await this.fetchAllowed(probe, {
      headers: conditionalHeaders(checkpoint, "application/json"),
    });
    if (response.status === 304) return { kind: "not-modified" };
    if (!response.ok && response.status !== 404) {
      throw upstreamError("datastore_search", response);
    }
    const envelope = parseActionEnvelope(
      await readBoundedResponse(response, CKAN_LIMITS.metadataBytes, "CKAN DataStore metadata"),
      "datastore_search",
    );
    if (response.status === 404) {
      if (isNotFoundEnvelope(envelope)) return { kind: "unavailable" };
      throw upstreamError("datastore_search", response);
    }
    const result = requireActionResult(envelope, "datastore_search");
    if (!Array.isArray(result.fields)) {
      throw invalidResponse("datastore_search omitted fields");
    }
    if (!isJsonNumber(result.total) || !Number.isSafeInteger(result.total) || result.total < 0) {
      throw invalidResponse("datastore_search returned an invalid total");
    }
    const total = result.total;
    const planned = Math.min(total, CKAN_LIMITS.datastorePageRows * CKAN_LIMITS.datastorePages);
    return {
      kind: "rows",
      fields: result.fields,
      completeness: planned < total ? "partial" : "complete",
      sourceUrl: datastorePageUrl(origin, resourceId, 0, Math.min(CKAN_LIMITS.datastorePageRows, Math.max(planned, 1))).toString(),
      body: this.datastoreRecords(origin, resourceId, planned, total),
    };
  }

  /**
   * The table as newline-delimited JSON records, one datastore_search page
   * fetched only when the reader has drained the previous one.
   */
  private datastoreRecords(origin: string, resourceId: string, planned: number, total: number): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let offset = 0;
    let page: DatastorePage | undefined;
    const release = async () => {
      const current = page;
      page = undefined;
      await current?.records.return?.(undefined);
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (true) {
          if (!page) {
            if (offset >= planned) {
              controller.close();
              return;
            }
            page = await this.datastorePage(origin, resourceId, offset, Math.min(CKAN_LIMITS.datastorePageRows, planned - offset));
          }
          const next = await page.records.next();
          if (!next.done) {
            if (offset >= planned) {
              // The page held more than was asked for: the planned rows are all read.
              await release();
              continue;
            }
            if (!isJsonObject(next.value)) {
              throw invalidResponse("datastore_search returned a non-object record");
            }
            page.count += 1;
            offset += 1;
            controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
            return;
          }
          const finished = page;
          page = undefined;
          const result = requireActionResult(finished.envelope(), "datastore_search");
          if (result.total !== total) {
            throw invalidResponse("datastore_search changed total during pagination");
          }
          if (finished.count === 0) {
            throw invalidResponse("datastore_search stopped before total records");
          }
        }
      },
      cancel: async () => {
        await release();
      },
    }, { highWaterMark: 0 });
  }

  private async datastorePage(origin: string, resourceId: string, offset: number, limit: number): Promise<DatastorePage> {
    const response = await this.fetchAllowed(datastorePageUrl(origin, resourceId, offset, limit), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw upstreamError("datastore_search", response);
    if (!response.body) throw invalidResponse("datastore_search returned an empty body");
    const stream = streamJsonArray(response.body, ["result", "records"], {
      maxElementBytes: DATASTORE_RECORD_BYTES,
      maxEnvelopeBytes: CKAN_LIMITS.metadataBytes,
    });
    return { records: stream.elements[Symbol.asyncIterator](), envelope: stream.envelope, count: 0 };
  }

  private async fetchAllowed(url: URL, init: RequestInit): Promise<Response> {
    validateResourceUrl(url.toString(), this.allowedHosts);
    const response = await this.fetcher(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      throw new GatekeeperError(`CKAN redirect from ${url.hostname} was refused`, "source-denied");
    }
    return response;
  }
}

function actionUrl(
  origin: string,
  action: "datastore_search" | "package_show",
  parameters: Record<string, string>,
): URL {
  const url = new URL(`/api/3/action/${action}`, origin);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function datastorePageUrl(origin: string, resourceId: string, offset: number, limit: number): URL {
  return actionUrl(origin, "datastore_search", {
    resource_id: resourceId,
    limit: String(limit),
    offset: String(offset),
  });
}

function selectResource(
  packageResult: JsonObject,
  requestedId: string | undefined,
): SelectedResource {
  if (!Array.isArray(packageResult.resources)) {
    throw invalidResponse("package_show omitted resources");
  }
  const candidates = packageResult.resources.filter(isJsonObject);
  const selected = requestedId
    ? candidates.find((candidate) => optionalString(candidate, "id")?.toLowerCase() === requestedId)
    : candidates.find((candidate) => SUPPORTED_FORMATS.has(normalizeFormat(candidate.format)));
  if (!selected) {
    throw new GatekeeperError(requestedId ? `Resource ${requestedId} does not belong to this dataset` : "Dataset has no CSV, JSON, or GeoJSON resource", "invalid-config");
  }
  const id = optionalString(selected, "id");
  const url = optionalString(selected, "url");
  const format = normalizeFormat(selected.format);
  if (!id || !RESOURCE_PATTERN.test(id) || !url || !SUPPORTED_FORMATS.has(format)) {
    throw invalidResponse("Selected resource metadata is incomplete or unsupported");
  }
  return {
    metadata: selected,
    id: id.toLowerCase(),
    url,
    // SAFETY: `format` was matched against the supported formats just above,
    // so it is one of the readings SelectedResource names.
    format: format as SelectedResource["format"],
    datastoreActive: selected.datastore_active === true,
  };
}

function compactPackage(value: JsonObject): JsonObject {
  const excluded = new Set([
    "resources",
    "relationships_as_object",
    "relationships_as_subject",
    "tracking_summary",
  ]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
}

function normalizeFormat(value: JsonValue | undefined): string {
  return isJsonString(value)
    ? value.trim().toLowerCase().replace(/^application\//, "")
    : "";
}

function validateResourceUrl(
  value: string,
  allowedHosts: ReadonlySet<string>,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidResponse("Resource URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw new GatekeeperError(`Resource host ${url.hostname || "unknown"} is not allowed`, "source-denied");
  }
  return url;
}

function sourcePublishedAt(
  resource: JsonObject,
  packageResult: JsonObject,
): string | undefined {
  for (const value of [resource.last_modified, packageResult.metadata_modified]) {
    if (!isJsonString(value)) continue;
    const milliseconds = Date.parse(value);
    if (!Number.isNaN(milliseconds)) return new Date(milliseconds).toISOString();
  }
  return undefined;
}

function checkpointMatches(
  checkpoint: SourceValidator | undefined,
  etag: string | undefined,
  lastModified: string | undefined,
): boolean {
  if (checkpoint?.etag) return etag !== undefined && checkpoint.etag === etag;
  return Boolean(
    checkpoint?.lastModified &&
      lastModified &&
      checkpoint.lastModified === lastModified,
  );
}

function conditionalHeaders(
  checkpoint: SourceValidator | undefined,
  accept: string,
): Headers {
  const headers = new Headers({ Accept: accept });
  if (checkpoint?.etag) headers.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    headers.set("If-Modified-Since", checkpoint.lastModified);
  }
  return headers;
}

function notModified(validator: SourceValidator): SourceNotModified {
  const fetch: SourceNotModified = { kind: "not-modified" };
  if (Object.keys(validator).length > 0) fetch.validator = validator;
  return fetch;
}

function sourceBody(
  body: ReadableStream<Uint8Array>,
  sourceUrl: string,
  publishedAt: string | undefined,
  completeness: Completeness,
  validator: SourceValidator,
): SourceBody {
  const provenance: SourceProvenance = { sourceUrl };
  if (publishedAt) provenance.sourcePublishedAt = publishedAt;
  const fetch: SourceBody = { kind: "body", body, provenance, completeness };
  if (Object.keys(validator).length > 0) fetch.validator = validator;
  return fetch;
}

function parseActionEnvelope(
  bytes: Uint8Array,
  action: string,
): JsonObject {
  let value: JsonValue;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse(`${action} returned invalid JSON`);
  }
  if (!isJsonObject(value) || !isJsonBoolean(value.success)) {
    throw invalidResponse(`${action} returned an invalid action envelope`);
  }
  return value;
}

function requireActionResult(
  envelope: JsonObject,
  action: string,
): JsonObject {
  if (envelope.success !== true) {
    throw new GatekeeperError(`CKAN ${action} action failed`, "upstream-error");
  }
  if (!isJsonObject(envelope.result)) {
    throw invalidResponse(`${action} returned an invalid result`);
  }
  return envelope.result;
}

function isNotFoundEnvelope(envelope: JsonObject): boolean {
  if (envelope.success !== false || !isJsonObject(envelope.error)) return false;
  const type = optionalString(envelope.error, "__type") ?? "";
  const message = optionalString(envelope.error, "message") ?? "";
  return /not found/i.test(`${type} ${message}`);
}

function upstreamError(action: string, response: Response): GatekeeperError {
  return new GatekeeperError(`CKAN ${action} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
}

