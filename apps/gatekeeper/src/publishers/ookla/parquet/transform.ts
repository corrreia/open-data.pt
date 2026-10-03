import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonString,
  streamNdjson,
  type CanonicalSchema,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { TILE_COLUMNS, type TilesMetadata } from "./parquet";
import { PORTUGAL, covers, tileCentre } from "./quadkeys";

const SCHEMA: CanonicalSchema = {
  fields: [
    field("quadkey", "identifier", false, undefined, "Quadkey (zoom-16 tile)"),
    field("quarter", "category", false),
    field("region", "category", false),
    field("latitude", "latitude", false, undefined, "Tile centre latitude"),
    field("longitude", "longitude", false, undefined, "Tile centre longitude"),
    field("download_kbps", "number", false, "kbit/s", "Average download speed"),
    field("upload_kbps", "number", false, "kbit/s", "Average upload speed"),
    field("latency_ms", "number", false, "ms", "Average latency"),
    field("download_latency_ms", "number", true, "ms", "Average latency while downloading"),
    field("upload_latency_ms", "number", true, "ms", "Average latency while uploading"),
    field("tests", "number", false, "tests", "Tests"),
    field("devices", "number", false, "devices", "Devices"),
  ],
};

/** Where a tile of Portugal lies: the Azores are the only part west of 20° W, Madeira and the Selvagens the only part south of 34° N. */
function region(latitude: number, longitude: number): string {
  if (longitude < -20) return "Azores";
  if (latitude < 34) return "Madeira";
  return "Mainland";
}

/** A count or an average Ookla states: a number, never negative; null where the file has none; undefined when it is neither. */
function measure(value: JsonValue | undefined): number | null | undefined {
  if (value === null) return null;
  return isJsonNumber(value) && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** What one tile's line says, or nothing when a value every tile has is missing or any value is not a measure. */
interface TileValues {
  download: number;
  upload: number;
  latency: number;
  downloadLatency: number | null;
  uploadLatency: number | null;
  tests: number;
  devices: number;
}

function valuesOf(line: readonly JsonValue[]): TileValues | undefined {
  const [download, upload, latency, downloadLatency, uploadLatency, tests, devices] = line.slice(1).map(measure);
  // Loaded latency began in Q4 2022, and not every Speedtest client measures it: the only values a tile may lack.
  if (downloadLatency === undefined || uploadLatency === undefined) return undefined;
  if (download == null || upload == null || latency == null || tests == null || devices == null) return undefined;
  return { download, upload, latency, downloadLatency, uploadLatency, tests, devices };
}

/**
 * The tiles of one quarter that fall on Portugal, one row each, keyed by
 * quadkey and dated by the quarter: the table is that quarter's map, and a
 * tile no one tested in it leaves the table, though not its history.
 */
export class TilesTransformer {
  readonly id = "ookla-parquet-tiles";
  readonly version = "1";

  transform(body: ReadableStream<Uint8Array>, context: TransformContext, metadata: TilesMetadata | undefined): StreamingTransform {
    if (!metadata || Number.isNaN(Date.parse(metadata.start)) || Number.isNaN(Date.parse(metadata.end)) || metadata.end <= metadata.start)
      throw new GatekeeperError("Ookla tiles need the quarter they were read for", "invalid-response");
    const { start, end, label } = metadata;
    const product: ProductDeclaration = {
      productKey: "tiles",
      slug: context.feed.slug.replace(/-feed$/, ""),
      title: context.feed.title,
      description: context.feed.description,
      kind: "record",
      role: context.feed.semantics.defaultProductRole,
      schema: SCHEMA,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
      watermark: start,
    };
    let accepted = 0;
    let rejected = 0;
    const seen = new Set<string>();
    async function* rows(): AsyncGenerator<NormalizedRow> {
      for await (const line of streamNdjson(body, { maxElementBytes: 1024 })) {
        if (!isJsonArray(line) || line.length !== TILE_COLUMNS.length + 1 || !isJsonString(line[0]))
          throw new GatekeeperError("An Ookla tile line is malformed", "invalid-response");
        const quadkey = line[0];
        const values = valuesOf(line);
        if (!values || !covers(PORTUGAL, quadkey) || seen.has(quadkey)) {
          rejected += 1;
          continue;
        }
        seen.add(quadkey);
        accepted += 1;
        const { latitude, longitude } = tileCentre(quadkey);
        yield {
          productKey: "tiles",
          record: {
            entityKey: quadkey,
            eventTime: start,
            validFrom: start,
            validTo: end,
            payload: {
              quadkey,
              quarter: label,
              region: region(latitude, longitude),
              latitude,
              longitude,
              download_kbps: values.download,
              upload_kbps: values.upload,
              latency_ms: values.latency,
              download_latency_ms: values.downloadLatency,
              upload_latency_ms: values.uploadLatency,
              tests: values.tests,
              devices: values.devices,
            },
          },
        };
      }
    }
    return {
      products: [product],
      rows: rows(),
      finish: () => ({ quality: { acceptedRecords: accepted, rejectedRecords: rejected } }),
    };
  }
}
