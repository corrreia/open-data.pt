import {
  GatekeeperError,
  contentEtag,
  isJsonArray,
  isJsonObject,
  isJsonString,
  readBoundedJson,
  retryAfterSeconds,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "../../index";

/** The token endpoint stays on the gateway's standard port, whose certificate chain is complete. */
export const METRO_TOKEN_URL = "https://api.metrolisboa.pt/oauth2/token";
/** The API's public documentation: the gateway answers only with keys, so this is the source link a person can open. */
export const METRO_DOCS_URL = "https://api.metrolisboa.pt/store/api-docs/admin/EstadoServicoML/1.0.1?gwType=apiGW&gwName=Production";
export const METRO_API_PATH = "/estadoServicoML/1.0.1";
/** One Metro Lisboa answer is a few kilobytes; a megabyte bounds a malfunctioning one. */
const RESPONSE_MAX_BYTES = 1024 * 1024;
const TOKEN_MAX_BYTES = 64 * 1024;
/** Everything one collection assembles, before the policy's own source cap applies. */
export const METRO_MAX_BYTES = 2 * 1024 * 1024;

export const METRO_LINES = ["amarela", "azul", "verde", "vermelha"] as const;
export type MetroLine = (typeof METRO_LINES)[number];
/** `S`: weekdays. `F`: weekends and public holidays. */
export const METRO_DAY_TYPES = ["S", "F"] as const;
export type MetroDayType = (typeof METRO_DAY_TYPES)[number];

export const METRO_FEEDS = {
  "line-status": {
    kind: "line-status",
    title: "Line status",
    description: "Whether each Metro line runs normally, with the operator's service message when it does not.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
  },
  "waiting-times": {
    kind: "waiting-times",
    title: "Waiting times",
    description: "The next trains at every platform, in seconds, as the operator computed them.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
  },
  stations: {
    kind: "stations",
    title: "Stations",
    description: "Every station with its position, lines, fare zone and page.",
    semantics: {
      domainSubject: "feature",
      defaultProductRole: "reference",
    },
  },
  headways: {
    kind: "headways",
    title: "Scheduled headways",
    description: "The scheduled interval between trains on each line by time band, for weekdays and for weekends and holidays.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export type MetroFeedName = keyof typeof METRO_FEEDS;

/** Everything one collection read from the API, handed to the normalizer as one JSON document. */
export type MetroDocument =
  | { feed: "line-status"; status: JsonObject }
  | { feed: "waiting-times"; waiting: JsonValue[]; destinations: JsonValue[] }
  | { feed: "stations"; stations: JsonValue[] }
  | { feed: "headways"; headways: Array<{ line: MetroLine; day: MetroDayType; rows: JsonValue[] }> };

/** The API store application's credentials, from Worker secrets. */
export interface MetroCredentials {
  key: string | undefined;
  secret: string | undefined;
}

export function validateMetroFeedConfig(config: SourceConfig): SourceConfig {
  const unexpected = Object.keys(config).filter((key) => key !== "feed");
  if (unexpected.length > 0) {
    throw new GatekeeperError(`Unsupported Metro Lisboa configuration field: ${unexpected[0]}`, "invalid-config");
  }
  if (!isMetroFeedName(config.feed)) {
    throw new GatekeeperError(`Metro Lisboa feeds require feed=${Object.keys(METRO_FEEDS).join(", ")}`, "invalid-config");
  }
  return { feed: config.feed };
}

/** The configured API origin: a bare https origin, nothing else, so every request stays on it. */
export function metroApiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("Metro Lisboa API origin is invalid", "source-denied");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new GatekeeperError("Metro Lisboa API origin must be a bare https origin", "source-denied");
  }
  return url.origin;
}

export async function collectMetroFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  credentials: MetroCredentials,
  fetcher: typeof fetch,
): Promise<SourceFetch> {
  const feed = feedName(validateMetroFeedConfig(config));
  const origin = metroApiOrigin(apiOrigin);
  const token = await accessToken(credentials, fetcher);
  const read = (path: string): Promise<JsonValue> => fetchResposta(origin, path, token, fetcher);

  let document: MetroDocument;
  let primary: string;
  switch (feed) {
    case "line-status": {
      primary = "estadoLinha/todos";
      const status = await read(primary);
      if (!isJsonObject(status)) throw unexpectedAnswer(primary);
      document = { feed, status };
      break;
    }
    case "waiting-times": {
      // A compound source: the platforms and the destination names their rows refer to, read together every time.
      primary = "tempoEspera/Estacao/todos";
      const waiting = listOf(await read(primary), primary);
      const destinations = listOf(await read("infoDestinos/todos"), "infoDestinos/todos");
      document = { feed, waiting, destinations };
      break;
    }
    case "stations": {
      primary = "infoEstacao/todos";
      document = { feed, stations: listOf(await read(primary), primary) };
      break;
    }
    case "headways": {
      // All eight line and day-type tables, or none: a missing one would make the snapshot silently partial.
      primary = `infoIntervalos/${METRO_LINES[0]}/${METRO_DAY_TYPES[0]}`;
      const headways: Array<{ line: MetroLine; day: MetroDayType; rows: JsonValue[] }> = [];
      for (const line of METRO_LINES) {
        for (const day of METRO_DAY_TYPES) {
          const path = `infoIntervalos/${line}/${day}`;
          headways.push({ line, day, rows: listOf(await read(path), path) });
        }
      }
      document = { feed, headways };
      break;
    }
  }

  const body = new TextEncoder().encode(JSON.stringify(document));
  if (body.byteLength > METRO_MAX_BYTES) {
    throw new GatekeeperError(`Metro Lisboa ${feed} collection exceeded ${METRO_MAX_BYTES} bytes`, "response-too-large");
  }
  // No answer carries a validator, so the content is its own: an identical answer is unchanged.
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return {
    kind: "body",
    body,
    provenance: { sourceUrl: METRO_DOCS_URL },
    completeness: "complete",
    validator,
  };
}

/** One OAuth 2 client-credentials token per collection; nothing is kept between requests. */
async function accessToken(credentials: MetroCredentials, fetcher: typeof fetch): Promise<string> {
  const { key, secret } = credentials;
  if (!key || !secret) {
    throw new GatekeeperError("Metro Lisboa API credentials are not configured (ML_CONSUMER_KEY and ML_CONSUMER_SECRET)", "invalid-config");
  }
  const response = await fetcher(METRO_TOKEN_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      Authorization: `Basic ${btoa(`${key}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  // Rejected credentials stay rejected until someone changes them: that is configuration, not a passing failure.
  if (response.status === 400 || response.status === 401) {
    throw new GatekeeperError(`Metro Lisboa rejected the API credentials (HTTP ${response.status})`, "invalid-config");
  }
  if (!response.ok) throw upstreamError(`Metro Lisboa's token endpoint returned HTTP ${response.status}`, response);
  const value = await readBoundedJson(response, TOKEN_MAX_BYTES, "Metro Lisboa token answer");
  const token = isJsonObject(value) && isJsonString(value.access_token) && value.access_token !== "" ? value.access_token : undefined;
  if (token === undefined) throw new GatekeeperError("Metro Lisboa's token endpoint returned no access token", "invalid-response");
  return token;
}

/** One API answer's `resposta`, after checking the transport, the size and the answer's own `codigo`. */
async function fetchResposta(origin: string, path: string, token: string, fetcher: typeof fetch): Promise<JsonValue> {
  const url = new URL(`${METRO_API_PATH}/${path}`, origin);
  const response = await fetcher(url, {
    redirect: "manual",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw upstreamError(`Metro Lisboa returned HTTP ${response.status} for ${path}`, response);
  const value = await readBoundedJson(response, RESPONSE_MAX_BYTES, `Metro Lisboa answer for ${path}`);
  if (!isJsonObject(value) || !Object.hasOwn(value, "resposta")) throw unexpectedAnswer(path);
  if (value.codigo !== "200") {
    throw new GatekeeperError(`Metro Lisboa answered code ${String(value.codigo)} for ${path}`, "upstream-error");
  }
  return value.resposta ?? null;
}

/** A list answer; out of service hours the waiting times are an empty one, which is a complete, empty snapshot. */
function listOf(value: JsonValue, path: string): JsonValue[] {
  if (!isJsonArray(value)) throw unexpectedAnswer(path);
  return value;
}

function unexpectedAnswer(path: string): GatekeeperError {
  return new GatekeeperError(`Metro Lisboa returned an unexpected answer for ${path}`, "invalid-response");
}

function upstreamError(message: string, response: Response): GatekeeperError {
  return new GatekeeperError(message, "upstream-error", retryAfterSeconds(response.headers));
}

function isMetroFeedName(value: string | undefined): value is MetroFeedName {
  return value !== undefined && Object.hasOwn(METRO_FEEDS, value);
}

function feedName(config: SourceConfig): MetroFeedName {
  const feed = config.feed;
  if (!isMetroFeedName(feed)) throw new GatekeeperError("Metro Lisboa feed is not configured", "invalid-config");
  return feed;
}
