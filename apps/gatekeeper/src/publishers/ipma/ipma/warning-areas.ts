import {
  GatekeeperError,
  field,
  fixedOrigin,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  streamJsonArray,
  upstreamResponseError,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type SourceBody,
  type SourceFetch,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { IPMA_WEB_ORIGIN } from "./lightning";

/**
 * The outlines IPMA's own warnings map draws, as its website serves them: one GeoJSON file of land areas and one of
 * the sea strips off them for the mainland, Madeira and the Azores. Each outline's `RegCode` is the `idAreaAviso` a
 * warning names. The files are assets of www.ipma.pt, not part of the documented API, and have not changed since
 * October 2021.
 */
export const IPMA_WARNING_AREA_FILES = [
  { file: "po-ww", surface: "land" },
  { file: "po-ww-sea", surface: "sea" },
  { file: "md-ww", surface: "land" },
  { file: "md-ww-sea", surface: "sea" },
  { file: "ac-ww", surface: "land" },
  { file: "ac-ww-sea", surface: "sea" },
] as const;

export const IPMA_WARNING_AREAS_PAGE = "/pt/otempo/";

/** The six files are 90 KB together; any one of them past this is not the file it was. */
const MAX_FILE_BYTES = 512 * 1024;
export const IPMA_WARNING_AREAS_MAX_BYTES = IPMA_WARNING_AREA_FILES.length * MAX_FILE_BYTES;

/**
 * Reads the six files, one after the other, and hands the transform their features in one collection, each marked
 * with the file it came from. All six are read every time: together they are the whole set of areas.
 */
export async function collectIpmaWarningAreas(webOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const origin = fixedOrigin(webOrigin, IPMA_WEB_ORIGIN);
  const features: JsonObject[] = [];
  let published: number | undefined;
  for (const { file, surface } of IPMA_WARNING_AREA_FILES) {
    const url = new URL(`/bin/file.data/${file}.geojson`, origin);
    const response = await fetcher(url, { headers: { Accept: "application/geo+json, application/json" }, redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw upstreamResponseError(response, `IPMA returned HTTP ${response.status} for ${file}.geojson`);
    }
    let parsed: JsonValue;
    try {
      parsed = parseJsonBytes(await readBoundedResponse(response, MAX_FILE_BYTES, `IPMA ${file}.geojson`));
    } catch (error) {
      if (error instanceof GatekeeperError) throw error;
      throw new GatekeeperError(`IPMA returned invalid JSON for ${file}.geojson`, "invalid-response");
    }
    if (!isJsonObject(parsed) || parsed.type !== "FeatureCollection" || !isJsonArray(parsed.features)) {
      throw new GatekeeperError(`IPMA ${file}.geojson must be a FeatureCollection`, "invalid-response");
    }
    for (const feature of parsed.features) {
      if (!isJsonObject(feature)) throw new GatekeeperError(`IPMA ${file}.geojson carries a feature that is not an object`, "invalid-response");
      features.push({ ...feature, file, surface });
    }
    const modified = Date.parse(response.headers.get("last-modified") ?? "");
    if (Number.isFinite(modified) && (published === undefined || modified > published)) published = modified;
  }
  const fetched: SourceBody = {
    kind: "body",
    body: new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features })),
    // The files have no page of their own; the map that draws them is on IPMA's weather page.
    provenance: { sourceUrl: new URL(IPMA_WARNING_AREAS_PAGE, origin).toString() },
    completeness: "complete",
    state: {},
  };
  if (published !== undefined) fetched.provenance.sourcePublishedAt = new Date(published).toISOString();
  return fetched;
}

const AREA_SCHEMA: CanonicalSchema = {
  fields: [
    field("areaCode", "identifier", false),
    field("surface", "category", false),
    field("name", "string", false),
    field("region", "category", false),
    field("regionId", "number", true),
    field("emmaId", "identifier", true),
    field("file", "category", false),
    field("geometry", "geometry", false),
  ],
};

/** The files' features, into one record per area and surface. */
export class IpmaWarningAreasTransformer {
  readonly id = "ipma-warning-areas";
  readonly version = "1";

  transform(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
    const document = streamJsonArray(body, ["features"], { maxElementBytes: MAX_FILE_BYTES });
    const seen = new Set<string>();
    let accepted = 0;

    async function* rows(): AsyncGenerator<NormalizedRow> {
      for await (const feature of document.elements) {
        const record = areaRecord(feature);
        if (seen.has(record.entityKey)) throw new GatekeeperError(`IPMA warning areas repeat ${record.entityKey}`, "invalid-response");
        seen.add(record.entityKey);
        if (seen.size > 500) throw new GatekeeperError("IPMA warning areas exceed their expected scope", "response-too-large");
        accepted += 1;
        yield { productKey: "areas", record };
      }
    }

    const products: ProductDeclaration[] = [
      {
        productKey: "areas",
        slug: "ipma-warning-areas",
        title: context.feed.title,
        description: context.feed.description,
        role: "reference",
        kind: "record",
        schema: AREA_SCHEMA,
        updateMode: "authoritative-snapshot",
        completeness: "complete",
      },
    ];
    return { products, rows: rows(), finish: () => ({ quality: { acceptedRecords: accepted, rejectedRecords: 0 } }) };
  }
}

function areaRecord(feature: JsonValue): CanonicalRecord {
  if (!isJsonObject(feature) || !isJsonObject(feature.properties) || !isJsonObject(feature.geometry) || !isJsonString(feature.file) || !isJsonString(feature.surface)) {
    throw new GatekeeperError("IPMA warning area must be a GeoJSON feature", "invalid-response");
  }
  const { properties, geometry, file, surface } = feature;
  if ((geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") || !isJsonArray(geometry.coordinates)) {
    throw new GatekeeperError(`IPMA warning area geometry in ${file} must be a polygon`, "invalid-response");
  }
  const areaCode = requiredString(properties.RegCode, "RegCode", file);
  return {
    entityKey: `${areaCode}:${surface}`,
    payload: {
      areaCode,
      surface,
      name: requiredString(properties.Name, "Name", file),
      region: requiredString(properties.AreaCode, "AreaCode", file),
      regionId: isJsonNumber(properties.RegionId) ? properties.RegionId : null,
      // The Azores' land file states none.
      emmaId: isJsonString(properties.EmmaId) && properties.EmmaId.trim() !== "" ? properties.EmmaId : null,
      file,
      geometry,
    },
  };
}

function requiredString(value: JsonValue | undefined, name: string, file: string): string {
  if (!isJsonString(value) || value.trim() === "") throw new GatekeeperError(`IPMA warning area in ${file} lacks ${name}`, "invalid-response");
  return value;
}
