import {
  GatekeeperError,
  allowedHosts,
  equivalentEtags,
  hashString,
  invalidResponse,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
  type SourceConfig,
} from "../../index";

export const GBFS_MAX_BYTES = 4 * 1024 * 1024;
const DISCOVERY_MAX_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const CONFIG_KEYS = new Set(["url", "language"]);
const COLLECTED_FEEDS = ["system_information", "vehicle_types", "station_information", "station_status"] as const;

type CollectedFeedName = (typeof COLLECTED_FEEDS)[number] | "free_bike_status";
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface FeedDescriptor {
  name: string;
  url: URL;
}

interface ParsedResource {
  bytes: Uint8Array;
  value: JsonObject;
}

export const GBFS_FEEDS = {
  system: {
    kind: "system",
    title: "GBFS shared-mobility system",
    description: "A GBFS system snapshot with vehicles, stations, fleet counts, and system reference information.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function allowedGbfsHosts(value: string): ReadonlySet<string> {
  const hosts = allowedHosts(value);
  if (hosts.size === 0 || [...hosts].some((host) => !isHostname(host))) {
    throw new GatekeeperError("GBFS ALLOWED_HOSTS is invalid", "source-denied");
  }
  return hosts;
}

export function validateGbfsFeedConfig(config: SourceConfig, allowedHosts: ReadonlySet<string>): SourceConfig {
  const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) {
    throw new GatekeeperError(`GBFS configuration does not accept ${unknown.sort().join(", ")}`, "invalid-config");
  }

  const url = validateSourceUrl(config.url, allowedHosts, "GBFS discovery URL");
  if (url.searchParams.size > 20) {
    throw new GatekeeperError("GBFS discovery URL has too many query parameters", "invalid-config");
  }

  const normalized: SourceConfig = { url: url.toString() };
  const language = config.language?.trim();
  if (language !== undefined && language !== "") {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language)) {
      throw new GatekeeperError("GBFS language must be a language tag such as pt or en-GB", "invalid-config");
    }
    normalized.language = language.toLowerCase();
  }
  return normalized;
}

export async function collectGbfsFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, allowedHostsValue: string, fetcher: Fetcher): Promise<SourceFetch> {
  const allowedHosts = allowedGbfsHosts(allowedHostsValue);
  const validated = validateGbfsFeedConfig(config, allowedHosts);
  const discoveryUrl = new URL(validated.url!);
  const discoveryResponse = await upstreamFetch(fetcher, discoveryUrl, conditionalHeaders(checkpoint));
  if (discoveryResponse.status === 304) {
    return notModified(discoveryResponse.headers, checkpoint);
  }
  assertSuccessful(discoveryResponse, "GBFS discovery");
  const discovery = await readJsonResource(discoveryResponse, discoveryUrl, DISCOVERY_MAX_BYTES, false);
  if (!discovery) throw tooLarge("GBFS discovery");
  const descriptors = parseDiscovery(discovery.value, validated.language, allowedHosts);

  const parts: Array<string | Uint8Array> = ['{"discovery":', discovery.bytes];
  let size = encodedSize(parts) + 1;
  if (size > GBFS_MAX_BYTES) throw tooLarge("GBFS document");
  let partial = false;
  const collected = new Map<CollectedFeedName, ParsedResource>();

  for (const name of COLLECTED_FEEDS) {
    const descriptor = descriptors.get(name);
    if (!descriptor) {
      if (name === "system_information") {
        throw invalidResponse("GBFS discovery omitted system_information");
      }
      continue;
    }
    const prefix = `,"${name}":`;
    const remaining = GBFS_MAX_BYTES - size - new TextEncoder().encode(prefix).byteLength;
    const resource = await fetchResource(fetcher, descriptor, remaining, name !== "system_information");
    if (!resource) {
      partial = true;
      continue;
    }
    validateResource(name, resource.value);
    parts.push(prefix, resource.bytes);
    size += new TextEncoder().encode(prefix).byteLength + resource.bytes.byteLength;
    collected.set(name, resource);
  }

  const vehicleDescriptor = descriptors.get("vehicle_status") ?? descriptors.get("free_bike_status");
  if (vehicleDescriptor) {
    const prefix = ',"free_bike_status":';
    const remaining = GBFS_MAX_BYTES - size - new TextEncoder().encode(prefix).byteLength;
    const resource = await fetchResource(fetcher, vehicleDescriptor, remaining, true);
    if (!resource) {
      partial = true;
    } else {
      validateResource("free_bike_status", resource.value);
      parts.push(prefix, resource.bytes);
      size += new TextEncoder().encode(prefix).byteLength + resource.bytes.byteLength;
      collected.set("free_bike_status", resource);
    }
  }

  parts.push("}");
  const body = joinBytes(parts);
  if (body.byteLength > GBFS_MAX_BYTES) throw tooLarge("GBFS document");

  const publicationResource = collected.get("free_bike_status") ?? collected.get("station_status") ?? discovery;
  const sourcePublishedAt = normalizeLastUpdated(publicationResource.value.last_updated);
  const etag = sourcePublishedAt ? syntheticEtag(sourcePublishedAt) : (discoveryResponse.headers.get("etag") ?? undefined);
  if (etag && checkpoint?.etag && equivalentEtags(etag, checkpoint.etag)) {
    return notModified(discoveryResponse.headers, checkpoint, etag);
  }

  const fetched: SourceBody = {
    kind: "body",
    body,
    provenance: { sourceUrl: discoveryUrl.toString() },
    completeness: partial ? "partial" : "complete",
  };
  if (sourcePublishedAt) fetched.provenance.sourcePublishedAt = sourcePublishedAt;
  const validator = validatorFrom(etag, discoveryResponse.headers.get("last-modified") ?? undefined);
  if (validator) fetched.validator = validator;
  return fetched;
}

function parseDiscovery(value: JsonObject, requestedLanguage: string | undefined, allowedHosts: ReadonlySet<string>): Map<string, FeedDescriptor> {
  const version = value.version;
  if (!isJsonString(version) || !/^[123](?:\.\d+)*$/u.test(version)) {
    throw invalidResponse("GBFS discovery has an unsupported version");
  }
  const major = Number(version.split(".")[0]);
  if (!isJsonObject(value.data)) {
    throw invalidResponse("GBFS discovery omitted data");
  }

  let block: JsonObject | undefined;
  if (Array.isArray(value.data.feeds)) {
    block = value.data;
  } else {
    const languages = Object.entries(value.data).filter((entry): entry is [string, JsonObject] => isJsonObject(entry[1]) && Array.isArray(entry[1].feeds));
    if (requestedLanguage) {
      block = languages.find(([language]) => language.toLowerCase() === requestedLanguage)?.[1];
      if (!block) {
        throw invalidResponse(`GBFS discovery does not offer language ${requestedLanguage}`);
      }
    } else {
      block = languages[0]?.[1];
    }
  }
  if (!block || !Array.isArray(block.feeds)) {
    throw invalidResponse("GBFS discovery did not contain a feed list");
  }

  const descriptors = new Map<string, FeedDescriptor>();
  for (const item of block.feeds) {
    if (!isJsonObject(item) || !nonEmptyString(item.name) || !nonEmptyString(item.url)) {
      throw invalidResponse("GBFS discovery contained a malformed feed descriptor");
    }
    if (descriptors.has(item.name)) {
      throw invalidResponse(`GBFS discovery repeated feed ${item.name}`);
    }
    const url = validateSourceUrl(item.url, allowedHosts, `GBFS ${item.name} URL`, "invalid-response");
    descriptors.set(item.name, { name: item.name, url });
  }
  if (major === 3 && !descriptors.has("vehicle_status") && descriptors.has("free_bike_status")) {
    throw invalidResponse("GBFS 3 discovery used free_bike_status instead of vehicle_status");
  }
  return descriptors;
}

async function fetchResource(fetcher: Fetcher, descriptor: FeedDescriptor, maximumBytes: number, allowOmission: boolean): Promise<ParsedResource | undefined> {
  if (maximumBytes <= 0) return undefined;
  const response = await upstreamFetch(fetcher, descriptor.url, new Headers({ Accept: "application/json" }));
  assertSuccessful(response, `GBFS ${descriptor.name}`);
  return readJsonResource(response, descriptor.url, maximumBytes, allowOmission);
}

async function upstreamFetch(fetcher: Fetcher, url: URL, headers: Headers): Promise<Response> {
  try {
    return await fetcher(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new GatekeeperError(`GBFS request failed${detail}`, "upstream-error");
  }
}

function assertSuccessful(response: Response, resource: string): void {
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`${resource} returned HTTP ${response.status}`, "upstream-error");
  }
}

async function readJsonResource(response: Response, url: URL, maximumBytes: number, allowOmission: boolean): Promise<ParsedResource | undefined> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maximumBytes) {
      await response.body?.cancel("GBFS resource exceeded the document cap");
      if (allowOmission) return undefined;
      throw tooLarge(`GBFS resource ${url.pathname}`);
    }
  }
  if (!response.body) {
    throw invalidResponse(`GBFS resource ${url.pathname} had no body`);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel("GBFS resource exceeded the document cap");
      if (allowOmission) return undefined;
      throw tooLarge(`GBFS resource ${url.pathname}`);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse(`GBFS resource ${url.pathname} returned invalid JSON`);
  }
  if (!isJsonObject(parsed)) {
    throw invalidResponse(`GBFS resource ${url.pathname} was not an object`);
  }
  validateEnvelope(parsed, url.pathname);
  return { bytes, value: parsed };
}

function validateEnvelope(value: JsonObject, resource: string): void {
  if (!isJsonObject(value.data)) {
    throw invalidResponse(`GBFS ${resource} omitted data`);
  }
  if (normalizeLastUpdated(value.last_updated) === undefined) {
    throw invalidResponse(`GBFS ${resource} omitted a valid last_updated`);
  }
  if (!isJsonNumber(value.ttl) || !Number.isFinite(value.ttl) || value.ttl < 0) {
    throw invalidResponse(`GBFS ${resource} omitted a valid ttl`);
  }
}

function validateResource(name: CollectedFeedName, value: JsonObject): void {
  const data = value.data;
  if (!isJsonObject(data)) throw invalidResponse(`GBFS ${name} omitted data`);
  const valid =
    name === "system_information"
      ? nonEmptyString(data.system_id) && nonEmptyLocalizedString(data.name)
      : name === "vehicle_types"
        ? Array.isArray(data.vehicle_types)
        : name === "station_information" || name === "station_status"
          ? Array.isArray(data.stations)
          : Array.isArray(data.bikes) || Array.isArray(data.vehicles);
  if (!valid) {
    throw invalidResponse(`GBFS ${name} returned an unexpected shape`);
  }
}

function validateSourceUrl(value: string | undefined, allowedHosts: ReadonlySet<string>, label: string, code: "invalid-config" | "invalid-response" = "invalid-config"): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new GatekeeperError(`${label} is invalid`, code, code === "invalid-response" ? 502 : 400);
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "") {
    throw new GatekeeperError(`${label} must be an HTTPS URL without credentials, a port, or a fragment`, code, code === "invalid-response" ? 502 : 400);
  }
  if (!allowedHosts.has(hostname)) {
    throw new GatekeeperError(`${label} host ${hostname} is not allowed`, code === "invalid-response" ? "source-denied" : "source-denied", code === "invalid-response" ? 502 : 403);
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

/**
 * Unchanged since the checkpoint: either the discovery document answered 304,
 * or the newest feed's `last_updated` (the synthetic etag) did not move.
 */
function notModified(upstream: Headers, checkpoint: SourceValidator | undefined, synthetic?: string): SourceNotModified {
  const fetched: SourceNotModified = { kind: "not-modified" };
  const validator = validatorFrom(synthetic ?? upstream.get("etag") ?? checkpoint?.etag, upstream.get("last-modified") ?? checkpoint?.lastModified);
  if (validator) fetched.validator = validator;
  return fetched;
}

function validatorFrom(etag: string | undefined, lastModified: string | undefined): SourceValidator | undefined {
  const validator: SourceValidator = {};
  if (etag) validator.etag = etag;
  if (lastModified) validator.lastModified = lastModified;
  return validator.etag || validator.lastModified ? validator : undefined;
}

function normalizeLastUpdated(value: JsonValue | undefined): string | undefined {
  if (isJsonNumber(value) && Number.isFinite(value) && value >= 0) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return isJsonString(value) ? normalizeDate(value) : undefined;
}

function normalizeDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}

function syntheticEtag(sourcePublishedAt: string): string {
  return `"gbfs-${hashString(sourcePublishedAt)}"`;
}

function joinBytes(parts: Array<string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = parts.map((part) => (part instanceof Uint8Array ? part : encoder.encode(part)));
  const result = new Uint8Array(encoded.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of encoded) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function encodedSize(parts: Array<string | Uint8Array>): number {
  const encoder = new TextEncoder();
  return parts.reduce((total, part) => total + (part instanceof Uint8Array ? part.byteLength : encoder.encode(part).byteLength), 0);
}

function isHostname(value: string): boolean {
  try {
    const url = new URL(`https://${value}`);
    return url.hostname === value && url.pathname === "/" && url.port === "";
  } catch {
    return false;
  }
}

function nonEmptyString(value: JsonValue | undefined): value is string {
  return isJsonString(value) && value.trim() !== "";
}

function nonEmptyLocalizedString(value: JsonValue | undefined): boolean {
  return nonEmptyString(value) || (Array.isArray(value) && value.some((entry) => isJsonObject(entry) && nonEmptyString(entry.text)));
}

function tooLarge(resource: string): GatekeeperError {
  return new GatekeeperError(`${resource} exceeded the ${GBFS_MAX_BYTES} byte cap`, "response-too-large");
}
