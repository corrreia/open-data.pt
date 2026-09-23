import {
  GatekeeperError,
  asArrayOrEmpty,
  asNumber,
  isJsonObject,
  optionalString,
  parseJsonBytes,
  readBoundedBytes,
  requireString,
  responseValidator,
  retryAfterSeconds,
  sourceValidator,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
  type SourceNotModified,
} from "#/index";

const MAX_METADATA_BYTES = 2 * 1024 * 1024;

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The dataset a uData feed reads, checked against the allowlist before anything is fetched. */
export function validateUdataSourceConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  const baseUrl = config.baseUrl;
  const dataset = config.dataset;
  if (baseUrl === undefined || dataset === undefined) {
    throw new GatekeeperError("uData sources require baseUrl and dataset", "invalid-config");
  }

  const url = parseBaseUrl(baseUrl);
  if (!hosts.has(url.hostname.toLowerCase())) {
    throw new GatekeeperError(`Source host ${url.hostname} is not allowed`, "source-denied");
  }

  const normalizedDataset = dataset.trim();
  if (normalizedDataset === "" || normalizedDataset.length > 200) {
    throw new GatekeeperError("dataset must contain between 1 and 200 characters", "invalid-config");
  }

  return { baseUrl: url.origin, dataset: normalizedDataset };
}

export class UdataSource {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly fetcher: Fetcher;

  constructor(allowedHosts: ReadonlySet<string>, fetcher: Fetcher) {
    this.allowedHosts = allowedHosts;
    this.fetcher = fetcher;
  }

  validateConfig(config: SourceConfig): SourceConfig {
    return validateUdataSourceConfig(config, this.allowedHosts);
  }

  /**
   * One distribution the bound dataset declares, as a stream: the body is
   * never buffered here, so its size is bounded only by the collection's
   * source budget, which the collector enforces on the wire.
   *
   * `previous` is the last collection's state. Its validators are sent only
   * when they came from the resource selected now: a format selector can move
   * to a newer release, whose 304 would otherwise pass as "unchanged".
   */
  async fetchDistribution(config: SourceConfig, selector: DistributionSelector, previous?: JsonObject): Promise<SourceFetch> {
    if (selector.kind === "id" && !/^[A-Za-z0-9_-]{1,200}$/.test(selector.id)) {
      throw new GatekeeperError("distributionId has an invalid format", "invalid-config");
    }

    const validated = this.validateConfig(config);
    const baseUrl = requireString(validated, "baseUrl");
    const datasetId = requireString(validated, "dataset");
    const metadataResponse = await this.fetcher(datasetEndpoint(baseUrl, datasetId), { headers: { Accept: "application/json" } });
    if (!metadataResponse.ok) throw upstreamError("uData dataset metadata", metadataResponse);
    if (!metadataResponse.body) {
      throw new GatekeeperError("uData dataset metadata was empty", "invalid-response");
    }

    const metadata = parsePayload(await readBoundedBytes(metadataResponse.body, MAX_METADATA_BYTES));
    const resource = selectResource(metadata.resources, selector);
    if (!resource) {
      throw new GatekeeperError(
        selector.kind === "id" ? `Distribution ${selector.id} does not belong to this dataset` : `This dataset declares no ${selector.format} distribution`,
        "invalid-config",
      );
    }

    // uData's resource endpoint proxies the publisher URL. Keeping the request
    // on the configured uData host prevents publisher metadata becoming an SSRF URL.
    const endpoint = new URL(`/api/1/datasets/r/${encodeURIComponent(resource.id)}`, baseUrl);
    const checkpoint = previous?.resource === resource.id ? sourceValidator(previous) : undefined;
    const requestHeaders = new Headers({ Accept: "*/*" });
    if (checkpoint?.etag) requestHeaders.set("If-None-Match", checkpoint.etag);
    if (checkpoint?.lastModified) {
      requestHeaders.set("If-Modified-Since", checkpoint.lastModified);
    }
    const response = await this.fetcher(endpoint, { headers: requestHeaders });
    const validator = responseValidator(response.headers);
    if (response.status === 304) {
      const unchanged: SourceNotModified = { kind: "not-modified" };
      if (validator) unchanged.validator = validator;
      return unchanged;
    }
    if (!response.ok) throw upstreamError("uData distribution", response);
    if (!response.body) {
      throw new GatekeeperError("uData distribution returned an empty body", "invalid-response");
    }

    const state: JsonObject = { resource: resource.id };
    if (validator) state.validators = { default: { ...validator } };
    const fetched: SourceBody = {
      kind: "body",
      body: response.body,
      provenance: { sourceUrl: resource.url },
      completeness: "complete",
      state,
    };
    const published = resource.lastModified ?? response.headers.get("last-modified") ?? undefined;
    if (published !== undefined && !Number.isNaN(Date.parse(published))) {
      fetched.provenance.sourcePublishedAt = new Date(published).toISOString();
    }
    return fetched;
  }
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("baseUrl must be a valid URL", "invalid-config");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new GatekeeperError("baseUrl must be an HTTPS URL without credentials", "invalid-config");
  }
  return url;
}

function datasetEndpoint(baseUrl: string, dataset: string): URL {
  return new URL(`/api/1/datasets/${encodeURIComponent(dataset)}/`, baseUrl);
}

function parsePayload(raw: Uint8Array): JsonObject {
  let payload: JsonValue;
  try {
    payload = parseJsonBytes(raw);
  } catch {
    throw new GatekeeperError("Source returned invalid JSON", "invalid-response");
  }
  if (!isJsonObject(payload)) {
    throw new GatekeeperError("Source returned an unexpected dataset document", "invalid-response");
  }
  return payload;
}

/**
 * Which of a dataset's distributions to read: one by its catalogue id, or the
 * newest one in a format, for publishers that upload each release as a new
 * resource (the startup registry gets a new id every month).
 */
export type DistributionSelector = { kind: "id"; id: string } | { kind: "format"; format: string };

/** One distribution of a uData dataset, as the catalogue lists it. */
interface UdataResource {
  id: string;
  url: string;
  format?: string;
  filesize?: number;
  lastModified?: string;
}

function selectResource(value: JsonValue | undefined, selector: DistributionSelector): UdataResource | undefined {
  const resources = asArrayOrEmpty(value).flatMap((candidate) => {
    const resource = catalogueResource(candidate);
    return resource ? [resource] : [];
  });
  if (selector.kind === "id") return resources.find((resource) => resource.id === selector.id);
  const format = selector.format.toLowerCase();
  let newest: UdataResource | undefined;
  for (const resource of resources) {
    if (resource.format?.toLowerCase() !== format) continue;
    if (!newest || (resource.lastModified ?? "") > (newest.lastModified ?? "")) newest = resource;
  }
  return newest;
}

function catalogueResource(candidate: JsonValue): UdataResource | undefined {
  if (!isJsonObject(candidate)) return undefined;
  const id = optionalString(candidate, "id");
  const url = optionalString(candidate, "url");
  if (id === undefined || url === undefined) return undefined;
  const resource: UdataResource = { id, url };
  const format = optionalString(candidate, "format");
  if (format !== undefined) resource.format = format;
  const filesize = asNumber(candidate.filesize);
  if (filesize !== undefined) resource.filesize = filesize;
  const lastModified = optionalString(candidate, "last_modified");
  if (lastModified !== undefined && !Number.isNaN(Date.parse(lastModified))) {
    // Catalogue timestamps are ISO 8601, so the newest one compares highest as text.
    resource.lastModified = new Date(lastModified).toISOString();
  }
  return resource;
}

/** A refused upstream response, carrying its status and any `Retry-After` the provider asked for. */
function upstreamError(label: string, response: Response): GatekeeperError {
  return new GatekeeperError(`${label} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
}
