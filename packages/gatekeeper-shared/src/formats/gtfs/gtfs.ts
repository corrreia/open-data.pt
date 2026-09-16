import {
  GatekeeperError,
  allowedHosts,
  responseValidator,
  retryAfterSeconds,
  type FeedKindDescription,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "../../index";
import { MAX_ARCHIVE_BYTES } from "./zip";

export const GTFS_ENTRY_NAMES = ["agency", "stops", "routes", "calendar", "calendar_dates", "trips", "shapes", "stop_times", "feed_info"] as const;

export const DEFAULT_GTFS_FILES = ["agency", "stops", "routes", "calendar", "calendar_dates", "feed_info"] as const;

export const GTFS_FEEDS = {
  static: {
    kind: "static",
    title: "GTFS static schedule",
    description: "A snapshot of selected files from a GTFS Schedule archive, normalized as the archive streams.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateGtfsFeedConfig(config: SourceConfig, allowedHostsValue: string): SourceConfig {
  const rawUrl = config.url?.trim();
  if (!rawUrl) {
    throw new GatekeeperError("GTFS feeds require a url", "invalid-config");
  }
  const url = parseAllowedUrl(rawUrl, allowedHostsValue);
  const files = requestedGtfsFiles(config.files);
  return { url: url.toString(), files: files.join(",") };
}

/**
 * Open the archive and hand its body on unread: the streaming normalizer reads
 * it entry by entry, so nothing here buffers it.
 */
export async function collectGtfsFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, allowedHostsValue: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateGtfsFeedConfig(config, allowedHostsValue);
  const requestHeaders = new Headers({ Accept: "application/zip, application/x-zip-compressed, application/octet-stream;q=0.9, */*;q=0.1" });
  if (checkpoint?.etag) requestHeaders.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) requestHeaders.set("If-Modified-Since", checkpoint.lastModified);

  const { response, sourceUrl } = await fetchFollowingAllowedRedirects(new URL(validated.url ?? ""), requestHeaders, allowedHostsValue, fetcher);

  if (response.status === 304) {
    await response.body?.cancel("GTFS archive not modified").catch(() => undefined);
    const unchanged: SourceFetch = { kind: "not-modified" };
    const validator = refreshedValidator(response.headers, checkpoint);
    if (validator) unchanged.validator = validator;
    return unchanged;
  }
  if (!response.ok) {
    await response.body?.cancel("GTFS source failed").catch(() => undefined);
    throw new GatekeeperError(`Source returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
  if (!response.body) {
    throw new GatekeeperError("GTFS source returned no archive body", "invalid-response");
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_ARCHIVE_BYTES) {
    await response.body.cancel("GTFS ZIP exceeded maximum archive size").catch(() => undefined);
    throw new GatekeeperError(`GTFS ZIP exceeded ${MAX_ARCHIVE_BYTES} bytes`, "response-too-large");
  }

  const fetched: SourceBody = {
    kind: "body",
    body: response.body,
    provenance: { sourceUrl },
    completeness: "complete",
  };
  const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
  if (!Number.isNaN(lastModified)) fetched.provenance.sourcePublishedAt = new Date(lastModified).toISOString();
  const validator = responseValidator(response.headers);
  if (validator) fetched.validator = validator;
  return fetched;
}

/** The comma-separated `files` option as known GTFS file names, in archive-conventional order. */
export function requestedGtfsFiles(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [...DEFAULT_GTFS_FILES];
  const requested = value.split(",").map((entry) => entry.trim().toLowerCase());
  if (requested.some((entry) => entry === "" || !GTFS_ENTRY_NAMES.some((name) => name === entry))) {
    throw new GatekeeperError(`GTFS files must be comma-separated names from: ${GTFS_ENTRY_NAMES.join(",")}`, "invalid-config");
  }
  return GTFS_ENTRY_NAMES.filter((entry) => requested.includes(entry));
}

/** A 304 may omit validators it did not change; keep the checkpoint's for those. */
function refreshedValidator(headers: Headers, previous: SourceValidator | undefined): SourceValidator | undefined {
  const validator: SourceValidator = {};
  const etag = headers.get("etag") ?? previous?.etag;
  const lastModified = headers.get("last-modified") ?? previous?.lastModified;
  if (etag) validator.etag = etag;
  if (lastModified) validator.lastModified = lastModified;
  return validator.etag || validator.lastModified ? validator : undefined;
}

async function fetchFollowingAllowedRedirects(
  initialUrl: URL,
  headers: Headers,
  allowedHostsValue: string,
  fetcher: typeof fetch,
): Promise<{ response: Response; sourceUrl: string }> {
  let url = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    parseAllowedUrl(url.toString(), allowedHostsValue);
    const response = await fetcher(url, { headers, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, sourceUrl: url.toString() };
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new GatekeeperError("GTFS source redirect omitted Location", "invalid-response");
    }
    await response.body?.cancel("Following validated GTFS redirect");
    url = parseAllowedUrl(new URL(location, url).toString(), allowedHostsValue);
  }
  throw new GatekeeperError("GTFS source redirected too many times", "invalid-response");
}

function parseAllowedUrl(value: string, allowed: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("GTFS url must be an absolute HTTPS URL", "invalid-config");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new GatekeeperError("GTFS url must use HTTPS without embedded credentials", "invalid-config");
  }
  if (!allowedHosts(allowed).has(url.hostname.toLowerCase())) {
    throw new GatekeeperError(`GTFS host ${url.hostname} is not allowed`, "source-denied");
  }
  url.hash = "";
  return url;
}
