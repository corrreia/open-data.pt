import {
  GatekeeperError,
  contentEtag,
  isJsonNumber,
  isJsonObject,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceProvenance,
  type SourceValidator,
} from "../../index";

export const ANEPC_API_ORIGIN = "https://api.sgifr.gov.pt";
export const ANEPC_MAX_BYTES = 4 * 1024 * 1024;

export const ANEPC_FEEDS = {
  "active-occurrences": {
    kind: "active-occurrences",
    title: "Active civil-protection occurrences",
    description: "Active protection-and-relief operations published by ANEPC through SGIFR, including accidents and fires.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateAnepcFeedConfig(config: SourceConfig): SourceConfig {
  if (config.feed !== "active-occurrences") throw new GatekeeperError("ANEPC requires feed=active-occurrences", "invalid-config");
  const unknown = Object.keys(config).find((key) => key !== "feed");
  if (unknown) throw new GatekeeperError(`Unsupported ANEPC configuration field: ${unknown}`, unknown === "host" || unknown === "url" ? "source-denied" : "invalid-config");
  return { feed: "active-occurrences" };
}

export function anepcUrl(origin: string): URL {
  if (origin !== ANEPC_API_ORIGIN) throw new GatekeeperError("The ANEPC API origin is not allowed", "source-denied");
  const url = new URL("/arcgis/rest/services/ANEPC/ocorrencias-ativas/FeatureServer/0/query", origin);
  url.searchParams.set("f", "geojson");
  url.searchParams.set("where", "1=1");
  url.searchParams.set(
    "outFields",
    "Numero,ID,EstadoOcorrencia,EstadoAgrupado,DataOcorrencia,FaseIncendio,CodNatureza,Natureza,Regiao,SubRegiao,Concelho,Freguesia,Localidade,Endereco,OperacionaisTerrestres,OPAereos,Operacionais,MeiosTerrestres,MeiosAereos,QuantEntidades,Latitude,Longitude,DataDosDados,RASI",
  );
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("orderByFields", "ID_oc");
  url.searchParams.set("resultRecordCount", "2000");
  return url;
}

export async function collectAnepcFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, origin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  validateAnepcFeedConfig(config);
  const url = anepcUrl(origin);
  const response = await request(fetcher, url);
  if (!response.ok) throw new GatekeeperError(`ANEPC returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  const bytes = await readBoundedResponse(response, ANEPC_MAX_BYTES, "ANEPC active occurrences");
  const root = document(bytes);
  const properties = isJsonObject(root.properties) ? root.properties : undefined;
  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) throw new GatekeeperError("ANEPC returned a malformed GeoJSON collection", "invalid-response");
  if (root.exceededTransferLimit === true || properties?.exceededTransferLimit === true)
    throw new GatekeeperError("ANEPC truncated the active occurrence snapshot", "upstream-error");
  // SAFETY: the FeatureCollection check above proves this member is a JSON array.
  const features = root.features as JsonValue[];
  const publishedAt = latestDataTime(features);
  const body = semanticBody(features);
  const etag = await contentEtag(body);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  const provenance: SourceProvenance = { sourceUrl: url.toString() };
  if (publishedAt) provenance.sourcePublishedAt = publishedAt;
  return { kind: "body", body, provenance, completeness: "complete", validator: { etag } };
}

function document(bytes: Uint8Array): JsonObject {
  let value;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("ANEPC returned invalid JSON", "invalid-response");
  }
  if (!isJsonObject(value)) throw new GatekeeperError("ANEPC returned a non-object response", "invalid-response");
  return value;
}

function semanticBody(features: JsonValue[]): Uint8Array {
  const semantic = features.map((candidate): JsonValue => {
    if (!isJsonObject(candidate) || !isJsonObject(candidate.properties)) return candidate;
    const properties = { ...candidate.properties };
    delete properties.DataDosDados;
    delete properties.ID_oc;
    const feature: JsonObject = { ...candidate, properties };
    delete feature.id;
    return feature;
  });
  return new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features: semantic }));
}

function latestDataTime(features: JsonValue[]): string | undefined {
  let latest: number | undefined;
  for (const candidate of features) {
    if (!isJsonObject(candidate) || !isJsonObject(candidate.properties)) continue;
    const value = candidate.properties.DataDosDados;
    if (isJsonNumber(value) && Number.isSafeInteger(value) && value > 0 && (latest === undefined || value > latest)) latest = value;
  }
  return latest === undefined ? undefined : new Date(latest).toISOString();
}

async function request(fetcher: typeof fetch, url: URL): Promise<Response> {
  try {
    const response = await fetcher(url, { headers: { Accept: "application/geo+json, application/json" }, redirect: "manual" });
    if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
      throw new GatekeeperError("ANEPC redirects are not allowed", "source-denied");
    return response;
  } catch (error) {
    if (error instanceof GatekeeperError) throw error;
    throw new GatekeeperError(`ANEPC request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
}
