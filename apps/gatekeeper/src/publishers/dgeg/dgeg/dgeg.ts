import {
  GatekeeperError,
  contentEtag,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  responseValidator,
  type FeedKindDescription,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
  type SourceConfig,
} from "../../../index";

export const DGEG_API_ORIGIN = "https://precoscombustiveis.dgeg.gov.pt";
export const FUEL_TYPES_MAX_BYTES = 256 * 1024;
export const FUEL_PRICES_MAX_BYTES = 6 * 1024 * 1024;
const PAGE_MAX_BYTES = 1024 * 1024;
const PAGE_SIZE = 500;
const MAX_PAGES_PER_DISTRICT = 20;
const DEFAULT_REQUEST_DELAY_MS = 350;

export const DGEG_FEEDS = {
  "fuel-prices": {
    kind: "fuel-prices",
    title: "Fuel prices",
    description: "Current retail prices for one fuel type, nationally or in one district.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
  },
  "fuel-types": {
    kind: "fuel-types",
    title: "Fuel types",
    description: "Fuel types, source units, and publication flags used by the price service.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

type DgegFeed = keyof typeof DGEG_FEEDS;
type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

interface CollectionOptions {
  requestDelayMs?: number;
}

interface FuelType {
  Id: number;
  Descritivo: string;
  UnidadeMedida: string;
  [field: string]: JsonValue;
}

interface District {
  Id: number;
  Descritivo: string;
  [field: string]: JsonValue;
}

interface AggregateDocument {
  fuelType: FuelType;
  district: District | null;
  fetchedPages: number;
  stations: JsonValue[];
}

export async function validateDgegFeedConfig(config: SourceConfig, apiOrigin: string, fetcher: Fetcher): Promise<SourceConfig> {
  const normalized = normalizeConfig(config);
  const origin = allowedOrigin(apiOrigin);
  if (normalized.feed === "fuel-types") return normalized;

  const fuelTypes = await fetchReferenceArray(origin, "GetTiposCombustiveis", fetcher);
  const fuelTypeId = Number(normalized.fuelTypeId);
  if (!fuelTypes.some((value) => numericId(value) === fuelTypeId)) {
    throw new GatekeeperError(`DGEG does not publish fuel type ${normalized.fuelTypeId}`, "invalid-config");
  }

  if (normalized.districtId) {
    const districts = await fetchReferenceArray(origin, "GetDistritos", fetcher);
    const districtId = Number(normalized.districtId);
    if (!districts.some((value) => numericId(value) === districtId)) {
      throw new GatekeeperError(`DGEG does not publish district ${normalized.districtId}`, "invalid-config");
    }
  }
  return normalized;
}

export async function collectDgegFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: Fetcher,
  options: CollectionOptions = {},
): Promise<SourceFetch> {
  const normalized = normalizeConfig(config);
  const origin = allowedOrigin(apiOrigin);
  if (normalized.feed === "fuel-types") {
    return collectFuelTypes(origin, checkpoint, fetcher);
  }
  return collectFuelPrices(normalized, checkpoint, origin, fetcher, options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS);
}

function normalizeConfig(config: SourceConfig): SourceConfig & { feed: DgegFeed } {
  const feed = config.feed;
  if (feed !== "fuel-prices" && feed !== "fuel-types") {
    throw new GatekeeperError("DGEG feeds require feed=fuel-prices or feed=fuel-types", "invalid-config");
  }
  const allowedKeys = new Set(feed === "fuel-prices" ? ["feed", "fuelTypeId", "districtId"] : ["feed"]);
  const unknown = Object.keys(config).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new GatekeeperError(`Unsupported DGEG configuration field: ${unknown}`, unknown === "host" || unknown === "url" ? "source-denied" : "invalid-config");
  }
  if (feed === "fuel-types") return { feed };

  const fuelTypeId = positiveInteger(config.fuelTypeId, "fuelTypeId");
  const districtId = config.districtId ? positiveInteger(config.districtId, "districtId") : undefined;
  const validated: SourceConfig & { feed: DgegFeed } = { feed, fuelTypeId };
  if (districtId) validated.districtId = districtId;
  return validated;
}

async function collectFuelTypes(origin: URL, checkpoint: SourceValidator | undefined, fetcher: Fetcher): Promise<SourceFetch> {
  const endpoint = apiUrl(origin, "GetTiposCombustiveis");
  const response = await fetcher(endpoint, {
    headers: requestHeaders(checkpoint),
  });
  if (response.status === 304) return notModified(response);
  requireSuccessfulResponse(response);
  const bytes = await readBoundedResponse(response, FUEL_TYPES_MAX_BYTES, "DGEG response");
  parseEnvelopeArray(bytes);

  const fetched: SourceBody = {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: endpoint.toString() },
    completeness: "complete",
  };
  const publishedAt = publishedAtFromLastModified(response.headers);
  if (publishedAt) fetched.provenance.sourcePublishedAt = publishedAt;
  const validator = responseValidator(response.headers);
  if (validator) fetched.validator = validator;
  return fetched;
}

async function collectFuelPrices(
  config: SourceConfig & { feed: DgegFeed },
  checkpoint: SourceValidator | undefined,
  origin: URL,
  fetcher: Fetcher,
  requestDelayMs: number,
): Promise<SourceFetch> {
  const fuelTypeId = Number(config.fuelTypeId);
  const fuelTypes = await fetchReferenceArray(origin, "GetTiposCombustiveis", fetcher);
  const fuelTypeValue = fuelTypes.find((value) => numericId(value) === fuelTypeId);
  const fuelType = asFuelType(fuelTypeValue);
  if (!fuelType) {
    throw new GatekeeperError(`DGEG does not publish fuel type ${config.fuelTypeId}`, "invalid-config");
  }

  const districtValues = await fetchReferenceArray(origin, "GetDistritos", fetcher);
  const districts = districtValues.map(asDistrict).filter((value): value is District => value !== undefined);
  if (districts.length !== districtValues.length) {
    throw new GatekeeperError("DGEG returned malformed districts", "invalid-response");
  }
  districts.sort((left, right) => left.Id - right.Id);

  const selectedDistrict = config.districtId ? districts.find((district) => district.Id === Number(config.districtId)) : undefined;
  if (config.districtId && !selectedDistrict) {
    throw new GatekeeperError(`DGEG does not publish district ${config.districtId}`, "invalid-config");
  }
  const requestedDistricts = selectedDistrict ? [selectedDistrict] : districts;
  const stations: JsonValue[] = [];
  let fetchedPages = 0;
  let partial = false;
  let firstPriceRequest = true;

  districtLoop: for (const district of requestedDistricts) {
    let districtRows = 0;
    let expectedRows: number | undefined;
    for (let page = 1; page <= MAX_PAGES_PER_DISTRICT; page += 1) {
      if (!firstPriceRequest) await delay(requestDelayMs);
      const endpoint = searchUrl(origin, fuelType.Id, district.Id, page);
      const response = await fetcher(endpoint, {
        headers: requestHeaders(firstPriceRequest ? checkpoint : undefined),
      });
      if (response.status === 304 && firstPriceRequest) return notModified(response);
      firstPriceRequest = false;
      requireSuccessfulResponse(response);
      const pageBytes = await readBoundedResponse(response, PAGE_MAX_BYTES, "DGEG page response");
      const pageRows = parseEnvelopeArray(pageBytes);
      expectedRows ??= pageRows.length > 0 ? totalRows(pageRows[0]) : 0;

      const candidate: AggregateDocument = {
        fuelType,
        district: selectedDistrict ?? null,
        fetchedPages: fetchedPages + 1,
        stations: [...stations, ...pageRows],
      };
      if (encode(candidate).byteLength > FUEL_PRICES_MAX_BYTES) {
        partial = true;
        break districtLoop;
      }
      stations.push(...pageRows);
      fetchedPages += 1;
      districtRows += pageRows.length;

      if (pageRows.length === 0 || districtRows >= expectedRows) break;
      if (pageRows.length < PAGE_SIZE) {
        partial = true;
        break districtLoop;
      }
      if (page === MAX_PAGES_PER_DISTRICT) {
        partial = true;
        break districtLoop;
      }
    }
  }

  const document: AggregateDocument = {
    fuelType,
    district: selectedDistrict ?? null,
    fetchedPages,
    stations,
  };
  const bytes = encode(document);
  const etag = await contentEtag(bytes);
  // The combined document has no upstream validator; its content hash is one.
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  const fetched: SourceBody = {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: sourceUrl(origin, fuelType.Id, selectedDistrict?.Id).toString() },
    completeness: partial ? "partial" : "complete",
    validator: { etag },
  };
  const publishedAt = latestStationUpdate(stations);
  if (publishedAt) fetched.provenance.sourcePublishedAt = publishedAt;
  return fetched;
}

function allowedOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new GatekeeperError("DGEG API origin is invalid", "source-denied");
  }
  if (origin.origin !== DGEG_API_ORIGIN || origin.pathname !== "/" || origin.username !== "" || origin.password !== "") {
    throw new GatekeeperError("DGEG API origin is not allowed", "source-denied");
  }
  return origin;
}

function positiveInteger(value: string | undefined, name: string): string {
  if (!value || !/^\d+$/.test(value)) {
    throw new GatekeeperError(`${name} must be a positive integer`, "invalid-config");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new GatekeeperError(`${name} must be a positive integer`, "invalid-config");
  }
  return String(parsed);
}

function apiUrl(origin: URL, method: string): URL {
  return new URL(`/api/PrecoComb/${method}`, origin);
}

function searchUrl(origin: URL, fuelTypeId: number, districtId: number, page: number): URL {
  const url = apiUrl(origin, "PesquisarPostos");
  url.searchParams.set("idsTiposComb", String(fuelTypeId));
  url.searchParams.set("idDistrito", String(districtId));
  url.searchParams.set("idsMunicipios", "");
  url.searchParams.set("qtdPorPagina", String(PAGE_SIZE));
  url.searchParams.set("pagina", String(page));
  return url;
}

function sourceUrl(origin: URL, fuelTypeId: number, districtId?: number): URL {
  const url = apiUrl(origin, "PesquisarPostos");
  url.searchParams.set("idsTiposComb", String(fuelTypeId));
  url.searchParams.set("idDistrito", districtId === undefined ? "" : String(districtId));
  url.searchParams.set("idsMunicipios", "");
  url.searchParams.set("qtdPorPagina", String(PAGE_SIZE));
  url.searchParams.set("pagina", "1");
  return url;
}

async function fetchReferenceArray(origin: URL, method: string, fetcher: Fetcher): Promise<JsonValue[]> {
  const response = await fetcher(apiUrl(origin, method), {
    headers: requestHeaders(undefined),
  });
  requireSuccessfulResponse(response);
  return parseEnvelopeArray(await readBoundedResponse(response, FUEL_TYPES_MAX_BYTES, "DGEG response"));
}

function requireSuccessfulResponse(response: Response): void {
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`DGEG returned HTTP ${response.status}`, "upstream-error");
  }
}

function parseEnvelopeArray(bytes: Uint8Array): JsonValue[] {
  let value: JsonValue;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("DGEG returned invalid JSON", "invalid-response");
  }
  if (!isJsonObject(value) || !isJsonBoolean(value.status)) {
    throw new GatekeeperError("DGEG returned a malformed envelope", "invalid-response");
  }
  if (!value.status) {
    const message = isJsonString(value.mensagem) ? value.mensagem.slice(0, 300) : "unknown error";
    throw new GatekeeperError(`DGEG rejected the request: ${message}`, "upstream-error");
  }
  if (!Array.isArray(value.resultado)) {
    throw new GatekeeperError("DGEG returned a non-array result", "invalid-response");
  }
  return value.resultado;
}

function numericId(value: JsonValue | undefined): number | undefined {
  if (!isJsonObject(value)) return undefined;
  const id = value.Id;
  return isJsonNumber(id) && Number.isSafeInteger(id) ? id : undefined;
}

function asFuelType(value: JsonValue | undefined): FuelType | undefined {
  if (!isJsonObject(value)) return undefined;
  if (
    !isJsonNumber(value.Id) ||
    !Number.isSafeInteger(value.Id) ||
    !isJsonString(value.Descritivo) ||
    value.Descritivo.trim() === "" ||
    !isJsonString(value.UnidadeMedida) ||
    value.UnidadeMedida.trim() === ""
  ) {
    return undefined;
  }
  // SAFETY: the checks above confirm the Id, Descritivo and UnidadeMedida a
  // FuelType names; every other field DGEG sends rides along as JSON.
  return value as FuelType;
}

function asDistrict(value: JsonValue | undefined): District | undefined {
  if (!isJsonObject(value)) return undefined;
  if (!isJsonNumber(value.Id) || !Number.isSafeInteger(value.Id) || !isJsonString(value.Descritivo) || value.Descritivo.trim() === "") {
    return undefined;
  }
  // SAFETY: the checks above confirm the Id and Descritivo a District names;
  // every other field DGEG sends rides along as JSON.
  return value as District;
}

function totalRows(value: JsonValue | undefined): number {
  if (!isJsonObject(value)) return 0;
  const total = value.Quantidade;
  return isJsonNumber(total) && Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

function requestHeaders(checkpoint: SourceValidator | undefined): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (checkpoint?.etag) headers.set("if-none-match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    headers.set("if-modified-since", checkpoint.lastModified);
  }
  return headers;
}

function notModified(response: Response): SourceNotModified {
  const fetched: SourceNotModified = { kind: "not-modified" };
  const validator = responseValidator(response.headers);
  if (validator) fetched.validator = validator;
  return fetched;
}

function publishedAtFromLastModified(headers: Headers): string | undefined {
  const lastModified = headers.get("last-modified");
  if (!lastModified) return undefined;
  const timestamp = Date.parse(lastModified);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function encode(document: AggregateDocument): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document));
}

function latestStationUpdate(stations: JsonValue[]): string | undefined {
  return stations
    .flatMap((station) => {
      if (!isJsonObject(station) || !isJsonString(station.DataAtualizacao)) return [];
      const timestamp = dgegDateTime(station.DataAtualizacao);
      return timestamp ? [timestamp] : [];
    })
    .sort()
    .at(-1);
}

/** Convert the mainland Portugal local timestamps published by DGEG to UTC. */
export function dgegDateTime(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const calendar = new Date(local);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return undefined;
  }
  const summerCandidate = local - 3_600_000;
  const summerStart = Date.UTC(year, 2, lastSunday(year, 2), 1);
  const summerEnd = Date.UTC(year, 9, lastSunday(year, 9), 1);
  const utc = summerCandidate >= summerStart && summerCandidate < summerEnd ? summerCandidate : local;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function lastSunday(year: number, month: number): number {
  const finalDay = new Date(Date.UTC(year, month + 1, 0));
  return finalDay.getUTCDate() - finalDay.getUTCDay();
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
