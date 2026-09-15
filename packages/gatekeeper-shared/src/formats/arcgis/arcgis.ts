import {
  GatekeeperError,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  streamJsonArray,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
} from "../../index";
import { MAX_FEATURE_BYTES } from "./transform";

export const MAX_METADATA_BYTES = 1024 * 1024;
/** Object-ID lists plan the pages before any feature is read, so they are buffered. */
const MAX_OBJECT_ID_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_SIZE = 1000;
/**
 * Upstream politeness: at most this many query pages per collection. A layer
 * larger than that is collected as a partial snapshot, decided before the
 * first page from the layer's count (or its object-ID list).
 */
const MAX_PAGES = 100;

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const ARCGIS_FEEDS = {
  layer: {
    kind: "layer",
    title: "ArcGIS feature layer",
    description:
      "A complete, periodically refreshed ArcGIS FeatureServer or MapServer layer with canonical attributes and geometry.",
    semantics: {
      domainSubject: "feature",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

interface ArcgisFieldMetadata {
  name: string;
  alias: string;
  type: string;
  nullable: boolean;
  domain?: {
    type: "codedValue";
    codedValues: Array<{ name: string; code: string | number }>;
  };
}

interface LayerMetadata {
  layerUrl: string;
  name: string;
  description: string;
  copyrightText: string;
  geometryType: string;
  objectIdField: string;
  globalIdField?: string;
  fields: ArcgisFieldMetadata[];
  maxRecordCount: number;
  lastEditDate?: number;
  supportsPagination: boolean;
  queryFormat: "geojson" | "json";
}

/** The layer description the collected document carries ahead of its features. */
interface LayerDescription {
  layerUrl: string;
  name: string;
  description: string;
  copyrightText: string;
  geometryType: string;
  objectIdField: string;
  globalIdField?: string;
  fields: ArcgisFieldMetadata[];
}

/** A layer URL split into the pieces the collector addresses it by. */
interface LayerAddress {
  hostname: string;
  service: string;
  layer: number;
}

/** How a layer is walked: offset pages, or pages of object IDs listed up front. */
type PagePlan =
  | { mode: "offset"; pageSize: number; partial: boolean }
  | { mode: "object-ids"; pageSize: number; partial: boolean; ids: Array<string | number> };

/** One query page: its features stream, and its paging flag is known once they are read. */
interface QueryPage {
  features: AsyncGenerator<JsonObject>;
  exceededTransferLimit(): boolean;
}

export function validateArcgisFeedConfig(
  config: SourceConfig,
  hosts: ReadonlySet<string>,
): SourceConfig {
  const keys = Object.keys(config).sort();
  if (keys.length === 1 && keys[0] === "layerUrl") {
    const parsed = parseLayerUrl(config.layerUrl ?? "", hosts);
    return {
      host: parsed.hostname.toLowerCase(),
      service: parsed.service,
      layer: String(parsed.layer),
    };
  }

  if (
    keys.length !== 3 ||
    !keys.includes("host") ||
    !keys.includes("service") ||
    !keys.includes("layer")
  ) {
    throw new GatekeeperError("ArcGIS layers require host, service, and layer, or one layerUrl", "invalid-config");
  }

  const host = normalizeHost(config.host ?? "", hosts);
  const service = normalizeService(config.service ?? "");
  const layer = normalizeLayer(config.layer ?? "");
  return { host, service, layer: String(layer) };
}

export function layerUrlFromConfig(config: SourceConfig): URL {
  return new URL(`https://${config.host}/${config.service}/${config.layer}`);
}

/**
 * Read the layer metadata, then hand back one GeoJSON document whose features
 * are fetched page by page only as the normalizer pulls them. Completeness is
 * decided here, before the first page, because the kernel receives it first.
 */
export async function collectArcgisFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  hosts: ReadonlySet<string>,
  fetcher: Fetcher,
): Promise<SourceFetch> {
  const validated = validateArcgisFeedConfig(config, hosts);
  const layerUrl = layerUrlFromConfig(validated);
  const metadataUrl = new URL(layerUrl);
  metadataUrl.searchParams.set("f", "json");
  const metadataHeaders = conditionalHeaders(checkpoint);
  metadataHeaders.set("Accept", "application/json");

  const metadataResponse = await fetcher(metadataUrl, {
    headers: metadataHeaders,
  });
  if (metadataResponse.status === 304) {
    return notModified(responseValidator(metadataResponse.headers) ?? checkpoint);
  }
  assertUpstreamResponse(metadataResponse, "layer metadata");
  const metadataPayload = parseDocument(
    await readBoundedResponse(metadataResponse, MAX_METADATA_BYTES, "ArcGIS layer metadata"),
    "layer metadata",
  );
  assertNoArcgisError(metadataPayload, "layer metadata");
  const metadata = parseLayerMetadata(metadataPayload, layerUrl.toString());
  const revision = revisionValidator(metadata.lastEditDate);
  if (
    revision !== undefined &&
    metadata.lastEditDate !== undefined &&
    (checkpoint?.etag === revision.etag ||
      (checkpoint?.lastModified !== undefined &&
        validDate(checkpoint.lastModified) >= metadata.lastEditDate))
  ) {
    return notModified(revision);
  }

  const pageSize = Math.min(metadata.maxRecordCount, MAX_PAGE_SIZE);
  const plan = metadata.supportsPagination
    ? await planOffsetPages(layerUrl, pageSize, fetcher)
    : await planObjectIdPages(layerUrl, pageSize, fetcher);
  const body: SourceBody = {
    kind: "body",
    body: layerDocument(describeLayer(metadata), layerFeatures(layerUrl, metadata, plan, fetcher)),
    provenance: { sourceUrl: layerUrl.toString() },
    completeness: plan.partial ? "partial" : "complete",
  };
  if (metadata.lastEditDate !== undefined) {
    body.provenance.sourcePublishedAt = new Date(metadata.lastEditDate).toISOString();
  }
  // Without an edit date there is no revision to compare, so every run
  // collects; stale validators are dropped rather than sent again.
  if (revision) body.validator = revision;
  else body.state = {};
  return body;
}

function describeLayer(metadata: LayerMetadata): LayerDescription {
  const arcgis: LayerDescription = {
    layerUrl: metadata.layerUrl,
    name: metadata.name,
    description: metadata.description,
    copyrightText: metadata.copyrightText,
    geometryType: metadata.geometryType,
    objectIdField: metadata.objectIdField,
    fields: metadata.fields,
  };
  if (metadata.globalIdField) arcgis.globalIdField = metadata.globalIdField;
  return arcgis;
}

/** `{"type":"FeatureCollection","arcgis":…,"features":[…]}`, one feature per pull. */
function layerDocument(arcgis: LayerDescription, features: AsyncGenerator<JsonObject>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let phase: "prefix" | "features" = "prefix";
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "prefix") {
        phase = "features";
        controller.enqueue(encoder.encode(`{"type":"FeatureCollection","arcgis":${JSON.stringify(arcgis)},"features":[`));
        return;
      }
      const next = await features.next();
      if (next.done) {
        controller.enqueue(encoder.encode("]}"));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${first ? "" : ","}${JSON.stringify(next.value)}`));
      first = false;
    },
    async cancel() {
      await features.return(undefined);
    },
  });
}

async function planOffsetPages(layerUrl: URL, pageSize: number, fetcher: Fetcher): Promise<PagePlan> {
  const response = await fetcher(buildCountUrl(layerUrl), { headers: { Accept: "application/json" } });
  assertUpstreamResponse(response, "feature count");
  const payload = parseDocument(await readBoundedResponse(response, MAX_METADATA_BYTES, "ArcGIS feature count"), "feature count");
  assertNoArcgisError(payload, "feature count");
  if (!isJsonObject(payload) || !finiteNonNegativeInteger(payload.count)) {
    invalid("ArcGIS feature count did not return a count");
  }
  return { mode: "offset", pageSize, partial: payload.count > pageSize * MAX_PAGES };
}

async function planObjectIdPages(layerUrl: URL, pageSize: number, fetcher: Fetcher): Promise<PagePlan> {
  const idsResponse = await fetcher(buildObjectIdsUrl(layerUrl), { headers: { Accept: "application/json" } });
  assertUpstreamResponse(idsResponse, "object ID query");
  const idsPayload = parseDocument(
    await readBoundedResponse(idsResponse, MAX_OBJECT_ID_BYTES, "ArcGIS object ID query"),
    "object ID query",
  );
  assertNoArcgisError(idsPayload, "object ID query");
  const objectIds = parseObjectIds(idsPayload).sort(compareObjectIds);
  const ids = objectIds.slice(0, pageSize * MAX_PAGES);
  return { mode: "object-ids", pageSize, partial: ids.length < objectIds.length, ids };
}

/** Every feature of the plan, as GeoJSON, fetching each page only when the previous one is used up. */
async function* layerFeatures(layerUrl: URL, metadata: LayerMetadata, plan: PagePlan, fetcher: Fetcher): AsyncGenerator<JsonObject> {
  if (plan.mode === "object-ids") {
    for (let index = 0; index < plan.ids.length; index += plan.pageSize) {
      const ids = plan.ids.slice(index, index + plan.pageSize);
      const page = await fetchQueryPage(buildObjectIdQueryUrl(layerUrl, metadata, ids), metadata, fetcher);
      yield* page.features;
      // The header already promised these IDs; a truncated page cannot be
      // reported as partial any more, so the collection fails instead.
      // Fewer features than IDs is a deletion since the ID query, and harmless.
      if (page.exceededTransferLimit()) invalid("ArcGIS truncated an object ID page");
    }
    return;
  }
  let offset = 0;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await fetchQueryPage(buildOffsetQueryUrl(layerUrl, metadata, offset, plan.pageSize), metadata, fetcher);
    let count = 0;
    for await (const feature of page.features) {
      count += 1;
      yield feature;
    }
    if (!page.exceededTransferLimit()) return;
    if (count === 0) invalid("ArcGIS reported another page but returned no features");
    offset += count;
  }
  if (!plan.partial) {
    throw new GatekeeperError("ArcGIS layer grew past the page cap while it was being collected", "upstream-error");
  }
}

async function fetchQueryPage(
  queryUrl: URL,
  metadata: LayerMetadata,
  fetcher: Fetcher,
): Promise<QueryPage> {
  const pageResponse = await fetcher(queryUrl, {
    headers: { Accept: "application/geo+json, application/json" },
  });
  assertUpstreamResponse(pageResponse, "layer query");
  if (!pageResponse.body) invalid("ArcGIS layer query returned an empty body");
  const document = streamJsonArray(pageResponse.body, ["features"], { maxElementBytes: MAX_FEATURE_BYTES, maxEnvelopeBytes: MAX_METADATA_BYTES });
  let envelope: JsonObject | undefined;
  const geojson = metadata.queryFormat === "geojson";
  async function* features(): AsyncGenerator<JsonObject> {
    let index = 0;
    for await (const feature of document.elements) {
      if (index === 0 && !geojson) assertWgs84SpatialReference(document.envelope().spatialReference);
      yield geojson ? geojsonFeature(feature) : esriFeature(feature, index, metadata.geometryType);
      index += 1;
    }
    envelope = document.envelope();
    assertNoArcgisError(envelope, "layer query");
    if (geojson && (envelope.type !== "FeatureCollection" || !isJsonArray(envelope.features))) {
      invalid("ArcGIS query did not return a GeoJSON FeatureCollection");
    }
    if (!geojson) {
      if (!isJsonArray(envelope.features)) invalid("ArcGIS query did not return an Esri JSON feature set");
      assertWgs84SpatialReference(envelope.spatialReference);
    }
  }
  return {
    features: features(),
    exceededTransferLimit: () => {
      const properties = isJsonObject(envelope?.properties) ? envelope.properties : undefined;
      return envelope?.exceededTransferLimit === true || (geojson && properties?.exceededTransferLimit === true);
    },
  };
}

function geojsonFeature(value: JsonValue): JsonObject {
  if (!isJsonObject(value) || value.type !== "Feature") {
    invalid("ArcGIS query returned a malformed GeoJSON feature");
  }
  return value;
}

function esriFeature(value: JsonValue, index: number, geometryType: string): JsonObject {
  if (!isJsonObject(value) || !isJsonObject(value.attributes)) {
    invalid("ArcGIS query returned a malformed Esri JSON feature");
  }
  return {
    type: "Feature",
    id: index,
    properties: value.attributes,
    geometry: value.geometry === null || value.geometry === undefined
      ? null
      : esriGeometryToGeojson(value.geometry, geometryType),
  };
}

function parseLayerUrl(
  value: string,
  hosts: ReadonlySet<string>,
): LayerAddress {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError("layerUrl must be a valid URL", "invalid-config");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new GatekeeperError("layerUrl must be an HTTPS URL without credentials, port, query, or fragment", "invalid-config");
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const layerText = parts.pop() ?? "";
  const service = normalizeService(parts.join("/"));
  const layer = normalizeLayer(layerText);
  const hostname = normalizeHost(url.hostname, hosts);
  return { hostname, service, layer };
}

function normalizeHost(value: string, hosts: ReadonlySet<string>): string {
  const host = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) {
    throw new GatekeeperError("host must be a hostname", "invalid-config");
  }
  if (!hosts.has(host)) {
    throw new GatekeeperError(`Source host ${host} is not allowed`, "source-denied");
  }
  return host;
}

function normalizeService(value: string): string {
  const service = value.trim().replace(/^\/+|\/+$/g, "");
  if (!/^[\w./-]+\/(FeatureServer|MapServer)$/.test(service)) {
    throw new GatekeeperError("service must end in FeatureServer or MapServer and contain only path-safe characters", "invalid-config");
  }
  const segments = service.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new GatekeeperError("service contains an unsafe path segment", "invalid-config");
  }
  return service;
}

function normalizeLayer(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value.trim())) {
    throw new GatekeeperError("layer must be a non-negative integer", "invalid-config");
  }
  const layer = Number(value);
  if (!Number.isSafeInteger(layer)) {
    throw new GatekeeperError("layer is outside the safe integer range", "invalid-config");
  }
  return layer;
}

function parseLayerMetadata(
  value: JsonValue | undefined,
  layerUrl: string,
): LayerMetadata {
  if (!isJsonObject(value)) invalid("ArcGIS layer metadata must be an object");
  const name = nonEmptyString(value.name, "layer name");
  const geometryType = nonEmptyString(value.geometryType, "geometry type");
  if (
    ![
      "esriGeometryPoint",
      "esriGeometryMultipoint",
      "esriGeometryPolyline",
      "esriGeometryPolygon",
    ].includes(geometryType)
  ) {
    invalid(`Unsupported ArcGIS geometry type: ${geometryType}`);
  }
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    invalid("ArcGIS layer metadata has no fields");
  }
  const fields = value.fields.map(parseFieldMetadata);
  const objectIdField = optionalNonEmptyString(value.objectIdField) ??
    fields.find((field) => field.type === "esriFieldTypeOID")?.name;
  if (!objectIdField) invalid("ArcGIS object ID field is missing");
  if (!fields.some((field) => field.name === objectIdField)) {
    invalid("ArcGIS object ID field is absent from the field list");
  }
  const globalIdField = optionalNonEmptyString(value.globalIdField) ??
    fields.find((field) => field.type === "esriFieldTypeGlobalID")?.name;
  const maxRecordCount = finitePositiveInteger(value.maxRecordCount)
    ? value.maxRecordCount
    : MAX_PAGE_SIZE;
  const editingInfo = isJsonObject(value.editingInfo) ? value.editingInfo : undefined;
  const lastEditDate = editingInfo && finiteNonNegativeInteger(editingInfo.lastEditDate)
    ? editingInfo.lastEditDate
    : undefined;
  const advanced = isJsonObject(value.advancedQueryCapabilities)
    ? value.advancedQueryCapabilities
    : undefined;
  const supportedFormats = isJsonString(value.supportedQueryFormats)
    ? value.supportedQueryFormats
    : undefined;
  const metadata: LayerMetadata = {
    layerUrl,
    name,
    description: isJsonString(value.description) ? value.description : "",
    copyrightText:
      isJsonString(value.copyrightText) ? value.copyrightText : "",
    geometryType,
    objectIdField,
    fields,
    maxRecordCount,
    supportsPagination: advanced?.supportsPagination !== false,
    queryFormat: supportedFormats !== undefined && /geojson/i.test(supportedFormats)
      ? "geojson"
      : "json",
  };
  if (globalIdField) metadata.globalIdField = globalIdField;
  if (lastEditDate !== undefined) metadata.lastEditDate = lastEditDate;
  return metadata;
}

function parseFieldMetadata(value: JsonValue | undefined): ArcgisFieldMetadata {
  if (!isJsonObject(value)) invalid("ArcGIS field metadata must be an object");
  const name = nonEmptyString(value.name, "field name");
  const alias = optionalNonEmptyString(value.alias) ?? name;
  const type = nonEmptyString(value.type, "field type");
  const domain = parseCodedDomain(value.domain);
  const field: ArcgisFieldMetadata = {
    name,
    alias,
    type,
    nullable: value.nullable !== false,
  };
  if (domain) field.domain = domain;
  return field;
}

function parseCodedDomain(
  value: JsonValue | undefined,
): ArcgisFieldMetadata["domain"] | undefined {
  if (!isJsonObject(value) || value.type !== "codedValue" || !Array.isArray(value.codedValues)) {
    return undefined;
  }
  const codedValues = value.codedValues.flatMap((entry) => {
    if (
      !isJsonObject(entry) ||
      !isJsonString(entry.name) ||
      (!isJsonString(entry.code) && !isJsonNumber(entry.code))
    ) {
      return [];
    }
    return [{ name: entry.name, code: entry.code }];
  });
  return { type: "codedValue", codedValues };
}

function esriGeometryToGeojson(
  value: JsonValue | undefined,
  geometryType: string,
): JsonObject {
  if (!isJsonObject(value)) invalid("ArcGIS query returned malformed Esri JSON geometry");
  assertWgs84SpatialReference(value.spatialReference);
  switch (geometryType) {
    case "esriGeometryPoint":
      return { type: "Point", coordinates: coordinate(value.x, value.y) };
    case "esriGeometryMultipoint":
      return { type: "MultiPoint", coordinates: coordinateList(value.points) };
    case "esriGeometryPolyline": {
      const paths = coordinateParts(value.paths, 2);
      return paths.length === 1 && paths[0] !== undefined
        ? { type: "LineString", coordinates: paths[0] }
        : { type: "MultiLineString", coordinates: paths };
    }
    case "esriGeometryPolygon":
      return polygonGeometry(value.rings);
    default:
      invalid(`Unsupported ArcGIS geometry type: ${geometryType}`);
  }
}

function polygonGeometry(value: JsonValue | undefined): JsonObject {
  const rings = coordinateParts(value, 4).map(closeRing);
  const exteriorRings = rings.filter((ring) => signedArea(ring) < 0);
  const holeRings = rings.filter((ring) => signedArea(ring) >= 0);
  const polygons = (exteriorRings.length > 0 ? exteriorRings : [rings[0]])
    .filter((ring): ring is number[][] => ring !== undefined)
    .map((exterior) => [orientRing(exterior, false)]);

  for (const hole of exteriorRings.length > 0 ? holeRings : rings.slice(1)) {
    const point = hole[0];
    const owner = point
      ? polygons.find((polygon) => pointInRing(point, polygon[0] ?? []))
      : undefined;
    if (owner) owner.push(orientRing(hole, true));
    else polygons.push([orientRing(hole, false)]);
  }

  return polygons.length === 1 && polygons[0] !== undefined
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

function coordinate(x: JsonValue | undefined, y: JsonValue | undefined): number[] {
  if (
    !isJsonNumber(x) ||
    !isJsonNumber(y) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    invalid("ArcGIS query returned a non-finite coordinate");
  }
  return [x, y];
}

function coordinateList(value: JsonValue | undefined): number[][] {
  if (!Array.isArray(value)) invalid("ArcGIS query returned malformed coordinates");
  return value.map((item) => {
    if (!Array.isArray(item)) invalid("ArcGIS query returned malformed coordinates");
    return coordinate(item[0], item[1]);
  });
}

function coordinateParts(value: JsonValue | undefined, minimumLength: number): number[][][] {
  if (!Array.isArray(value)) invalid("ArcGIS query returned malformed coordinate parts");
  return value.map((part) => {
    const coordinates = coordinateList(part);
    if (coordinates.length < minimumLength) {
      invalid("ArcGIS query returned a coordinate part with too few positions");
    }
    return coordinates;
  });
}

function closeRing(ring: number[][]): number[][] {
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last) return ring;
  return first[0] === last[0] && first[1] === last[1]
    ? ring
    : [...ring, [...first]];
}

function signedArea(ring: number[][]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (start && end) twiceArea += (start[0] ?? 0) * (end[1] ?? 0) - (end[0] ?? 0) * (start[1] ?? 0);
  }
  return twiceArea / 2;
}

function orientRing(ring: number[][], clockwise: boolean): number[][] {
  const isClockwise = signedArea(ring) < 0;
  return isClockwise === clockwise ? ring : [...ring].reverse();
}

function pointInRing(point: number[], ring: number[][]): boolean {
  const x = point[0];
  const y = point[1];
  if (x === undefined || y === undefined) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const currentX = currentPoint[0];
    const currentY = currentPoint[1];
    const previousX = previousPoint[0];
    const previousY = previousPoint[1];
    if (
      currentX === undefined || currentY === undefined ||
      previousX === undefined || previousY === undefined
    ) continue;
    const intersects = (currentY > y) !== (previousY > y) &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function assertWgs84SpatialReference(value: JsonValue | undefined): void {
  if (value === undefined || value === null) return;
  if (!isJsonObject(value)) invalid("ArcGIS query returned malformed spatial reference metadata");
  const wkid = isJsonNumber(value.latestWkid) ? value.latestWkid : value.wkid;
  if (wkid !== undefined && wkid !== 4326) {
    invalid(`ArcGIS ignored outSR=4326 and returned spatial reference ${String(wkid)}`);
  }
}

function parseObjectIds(value: JsonValue | undefined): Array<string | number> {
  if (!isJsonObject(value) || !Array.isArray(value.objectIds)) {
    invalid("ArcGIS object ID query did not return objectIds");
  }
  return value.objectIds.map((id) => {
    if (
      (!isJsonString(id) && !isJsonNumber(id)) ||
      String(id) === "" ||
      (isJsonNumber(id) && !Number.isFinite(id))
    ) {
      invalid("ArcGIS object ID query returned an invalid object ID");
    }
    return id;
  });
}

function compareObjectIds(left: string | number, right: string | number): number {
  if (isJsonNumber(left) && isJsonNumber(right)) return left - right;
  return String(left).localeCompare(String(right));
}

function buildCountUrl(layerUrl: URL): URL {
  const queryUrl = new URL(`${layerUrl.toString()}/query`);
  queryUrl.searchParams.set("where", "1=1");
  queryUrl.searchParams.set("returnCountOnly", "true");
  queryUrl.searchParams.set("f", "json");
  return queryUrl;
}

function buildOffsetQueryUrl(
  layerUrl: URL,
  metadata: LayerMetadata,
  offset: number,
  pageSize: number,
): URL {
  const queryUrl = new URL(`${layerUrl.toString()}/query`);
  queryUrl.searchParams.set("where", "1=1");
  queryUrl.searchParams.set("outFields", "*");
  queryUrl.searchParams.set("f", metadata.queryFormat);
  queryUrl.searchParams.set("outSR", "4326");
  queryUrl.searchParams.set("resultOffset", String(offset));
  queryUrl.searchParams.set("resultRecordCount", String(pageSize));
  queryUrl.searchParams.set("orderByFields", metadata.objectIdField);
  return queryUrl;
}

function buildObjectIdsUrl(layerUrl: URL): URL {
  const queryUrl = new URL(`${layerUrl.toString()}/query`);
  queryUrl.searchParams.set("where", "1=1");
  queryUrl.searchParams.set("returnIdsOnly", "true");
  queryUrl.searchParams.set("f", "json");
  return queryUrl;
}

function buildObjectIdQueryUrl(
  layerUrl: URL,
  metadata: LayerMetadata,
  ids: Array<string | number>,
): URL {
  const queryUrl = new URL(`${layerUrl.toString()}/query`);
  queryUrl.searchParams.set("objectIds", ids.join(","));
  queryUrl.searchParams.set("outFields", "*");
  queryUrl.searchParams.set("f", metadata.queryFormat);
  queryUrl.searchParams.set("outSR", "4326");
  queryUrl.searchParams.set("orderByFields", metadata.objectIdField);
  return queryUrl;
}

function conditionalHeaders(checkpoint?: SourceValidator): Headers {
  const headers = new Headers();
  if (checkpoint?.etag) headers.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    headers.set("If-Modified-Since", checkpoint.lastModified);
  }
  return headers;
}

/** The validators an edit date gives: a weak ETag and its HTTP date. */
function revisionValidator(lastEditDate: number | undefined): SourceValidator | undefined {
  if (lastEditDate === undefined) return undefined;
  return { etag: `W/"${lastEditDate}"`, lastModified: new Date(lastEditDate).toUTCString() };
}

function notModified(validator: SourceValidator | undefined): SourceNotModified {
  const result: SourceNotModified = { kind: "not-modified" };
  if (validator) result.validator = validator;
  return result;
}

function assertUpstreamResponse(response: Response, operation: string): void {
  if (!response.ok) {
    throw new GatekeeperError(`ArcGIS ${operation} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
}

function assertNoArcgisError(value: JsonValue | undefined, operation: string): void {
  if (!isJsonObject(value) || !isJsonObject(value.error)) return;
  const message = isJsonString(value.error.message)
    ? `: ${value.error.message}`
    : "";
  throw new GatekeeperError(`ArcGIS ${operation} returned an error${message}`, "upstream-error");
}

function parseDocument(bytes: Uint8Array, label: string): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`ArcGIS ${label} returned invalid JSON`, "invalid-response");
  }
}

function invalid(message: string): never {
  throw new GatekeeperError(message, "invalid-response");
}

function nonEmptyString(value: JsonValue | undefined, label: string): string {
  if (!isJsonString(value) || value.trim() === "") {
    invalid(`ArcGIS ${label} is missing`);
  }
  return value;
}

function optionalNonEmptyString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value : undefined;
}

function finitePositiveInteger(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isInteger(value) && value > 0;
}

function finiteNonNegativeInteger(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isInteger(value) && value >= 0;
}

function validDate(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? -1 : timestamp;
}
