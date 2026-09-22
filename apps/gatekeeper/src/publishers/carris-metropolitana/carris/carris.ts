import {
  GatekeeperError,
  responseValidator,
  type FeedKindDescription,
  type SourceBody,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
  type SourceConfig,
} from "../../../index";

export const CARRIS_FEEDS = {
  alerts: {
    kind: "alerts",
    title: "Service alerts",
    description: "Active service alerts and their validity periods.",
    semantics: {
      domainSubject: "event",
      defaultProductRole: "event-log",
    },
  },
  routes: {
    kind: "routes",
    title: "Route variants",
    description: "Every route variant of every line, with colours and served municipalities.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
  stops: {
    kind: "stops",
    title: "Stops",
    description: "Every stop in the network with its position, municipality, and served lines.",
    semantics: {
      domainSubject: "feature",
      defaultProductRole: "reference",
    },
  },
  lines: {
    kind: "lines",
    title: "Transit lines",
    description: "The current Carris Metropolitana line reference catalog.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
  vehicles: {
    kind: "vehicles",
    title: "Vehicle positions",
    description: "The latest known vehicle position and operating state.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

type FeedName = keyof typeof CARRIS_FEEDS;

export function validateCarrisFeedConfig(config: SourceConfig): SourceConfig {
  const feed = config.feed;
  if (!isFeedName(feed)) {
    throw new GatekeeperError("Carris feeds require feed=lines, routes, stops, vehicles, or alerts", "invalid-config");
  }
  return { feed };
}

export async function collectCarrisFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateCarrisFeedConfig(config);
  // SAFETY: `validateCarrisFeedConfig` has just confirmed `feed` names one of
  // the feeds this Gatekeeper offers.
  const feed = validated.feed as FeedName;
  const endpoint = new URL(`/v2/${feed}`, apiOrigin);
  const headers = new Headers({ Accept: "application/json" });
  if (checkpoint?.etag) headers.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    headers.set("If-Modified-Since", checkpoint.lastModified);
  }

  const response = await fetcher(endpoint, { headers });
  const validator = responseValidator(response.headers);
  if (response.status === 304) {
    const unchanged: SourceNotModified = { kind: "not-modified" };
    if (validator) unchanged.validator = validator;
    return unchanged;
  }
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`Carris Metropolitana returned HTTP ${response.status}`, "upstream-error");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > 12 * 1024 * 1024) {
    throw new GatekeeperError("Carris Metropolitana response exceeded 12 MiB", "response-too-large");
  }

  const fetched: SourceBody = {
    kind: "body",
    body: response.body,
    provenance: { sourceUrl: endpoint.toString() },
    // Every Carris endpoint answers with its whole current set.
    completeness: "complete",
  };
  const sourcePublishedAt = response.headers.get("last-modified");
  if (sourcePublishedAt) fetched.provenance.sourcePublishedAt = sourcePublishedAt;
  if (validator) fetched.validator = validator;
  return fetched;
}

function isFeedName(value: string | undefined): value is FeedName {
  return value !== undefined && Object.hasOwn(CARRIS_FEEDS, value);
}
