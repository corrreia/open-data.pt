import {
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  streamJsonArray,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductFinalization,
  type StreamingTransform,
  type TransformContext,
} from "../../index";
import type { StacCollectionDescription } from "./stac";

/**
 * Largest single item read from a page. A STAC item is metadata, but some
 * catalogues stamp every one with the full WKT of its coordinate system.
 */
export const MAX_ITEM_BYTES = 1024 * 1024;
/** Largest record published: the kernel stores one whole, in SQLite. */
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const PRODUCT_KEY = "items";

/**
 * What a tile is, as a row.
 *
 * The item's own `datetime` is deliberately not here. On the catalogue this
 * library was written against it is the moment the tile was loaded into the
 * database — every tile of the 2025 coverage carries a 2026 timestamp, seconds
 * apart, in load order — so publishing it as when the ground was photographed
 * would be a lie, and dating the row by it would make a decade-old photograph
 * look like news. When the ground was flown is a property of the coverage, not
 * of one tile, and the feed's description carries it.
 */
const SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("collection", "category", false),
    field("west", "number", true, "°"),
    field("south", "number", true, "°"),
    field("east", "number", true, "°"),
    field("north", "number", true, "°"),
    field("latitude", "latitude", true),
    field("longitude", "longitude", true),
    field("resolution", "number", true, "m"),
    field("widthPixels", "number", true, "px"),
    field("heightPixels", "number", true, "px"),
    field("bands", "number", true),
    field("bandNames", "string", true),
    field("crs", "category", true),
    field("fileBytes", "number", true, "B"),
    field("fileType", "category", true),
    field("file", "url", true),
    field("catalogued", "datetime", true),
  ],
};

export class StacTransformer {
  readonly id = "stac-items";
  readonly version = "1";

  transform(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
    const document = streamJsonArray(body, ["features"], { maxElementBytes: MAX_ITEM_BYTES, maxEnvelopeBytes: MAX_ENVELOPE_BYTES });
    let accepted = 0;
    let total = 0;

    const rows = async function* (): AsyncGenerator<NormalizedRow> {
      for await (const item of document.elements) {
        total += 1;
        const record = itemRecord(item);
        if (!record) continue;
        accepted += 1;
        yield { productKey: PRODUCT_KEY, record };
      }
    };

    return {
      products: [
        {
          productKey: PRODUCT_KEY,
          slug: context.feed.slug.replace(/-feed$/u, ""),
          title: context.feed.title,
          description: context.feed.description,
          role: "reference",
          kind: "record",
          schema: SCHEMA,
          updateMode: "authoritative-snapshot",
          completeness: "complete",
        },
      ],
      rows: rows(),
      finish: () => {
        const envelope = document.envelope();
        // A walk this feed's own page cap ended is a part of the collection, and
        // may not retract the tiles it never reached.
        const final: ProductFinalization = { productKey: PRODUCT_KEY };
        if (envelope.truncated === true) final.completeness = "partial";
        else final.completeness = "complete";
        return { quality: { acceptedRecords: accepted, rejectedRecords: total - accepted }, products: [final] };
      },
    };
  }
}

/** The description the collector wrote ahead of the items, for a feed's own use. */
export function collectionOf(value: JsonValue | undefined): StacCollectionDescription | undefined {
  if (!isJsonObject(value)) return undefined;
  if (!isJsonString(value.collectionId) || !isJsonString(value.itemsUrl)) return undefined;
  const described: StacCollectionDescription = {
    itemsUrl: value.itemsUrl,
    collectionUrl: isJsonString(value.collectionUrl) ? value.collectionUrl : value.itemsUrl,
    collectionId: value.collectionId,
    title: isJsonString(value.title) ? value.title : value.collectionId,
    description: isJsonString(value.description) ? value.description : "",
  };
  if (isJsonString(value.start)) described.start = value.start;
  if (isJsonString(value.end)) described.end = value.end;
  return described;
}

function itemRecord(item: JsonValue): CanonicalRecord | undefined {
  if (!isJsonObject(item) || !isJsonString(item.id) || item.id.trim() === "") return undefined;
  const properties = isJsonObject(item.properties) ? item.properties : {};
  const box = bbox(item.bbox);
  const asset = primaryAsset(item.assets);
  const pixels = pair(properties.size);
  const resolution = pair(properties.pixelSize);

  const payload: JsonObject = {
    id: item.id,
    collection: isJsonString(item.collection) ? item.collection : "",
    west: box?.[0] ?? null,
    south: box?.[1] ?? null,
    east: box?.[2] ?? null,
    north: box?.[3] ?? null,
    latitude: box ? round((box[1] + box[3]) / 2) : null,
    longitude: box ? round((box[0] + box[2]) / 2) : null,
    // The transform writes the pixel size as a signed pair; its size on the
    // ground is the same either way, so the magnitude is what is published.
    resolution: resolution ? round(Math.abs(resolution[0])) : null,
    widthPixels: pixels?.[0] ?? null,
    heightPixels: pixels?.[1] ?? null,
    bands: asset?.bands ?? null,
    bandNames: asset?.bandNames ?? null,
    crs: isJsonNumber(properties["proj:epsg"]) ? `EPSG:${properties["proj:epsg"]}` : null,
    fileBytes: isJsonNumber(properties["file:size"]) ? properties["file:size"] : null,
    fileType: asset?.type ?? null,
    file: asset?.href ?? null,
    catalogued: isJsonString(properties.datetime) ? properties.datetime : null,
  };

  const record: CanonicalRecord = { entityKey: item.id, payload };
  const encoded = JSON.stringify(record);
  if (encoded.length * 3 > MAX_RECORD_BYTES && utf8Length(encoded) > MAX_RECORD_BYTES) return undefined;
  return record;
}

interface PrimaryAsset {
  href: string | null;
  type: string | null;
  bands: number | null;
  bandNames: string | null;
}

/**
 * The asset a row points at. A STAC item may carry several; the one published
 * is the one the catalogue marks as the data itself, or its only one.
 */
function primaryAsset(assets: JsonValue | undefined): PrimaryAsset | undefined {
  if (!isJsonObject(assets)) return undefined;
  const entries = Object.entries(assets).filter((entry): entry is [string, JsonObject] => isJsonObject(entry[1]));
  if (entries.length === 0) return undefined;
  const chosen = entries.find(([name]) => name === "data" || name === "visual" || name === "Data") ?? entries[0];
  if (!chosen) return undefined;
  const asset = chosen[1];
  const bands = isJsonArray(asset["eo:bands"]) ? asset["eo:bands"] : undefined;
  const names = bands
    ?.map((band) => (isJsonObject(band) ? ((isJsonString(band.common_name) ? band.common_name : undefined) ?? (isJsonString(band.name) ? band.name : undefined)) : undefined))
    .filter((name): name is string => name !== undefined);
  return {
    href: isJsonString(asset.href) ? asset.href : null,
    type: isJsonString(asset.type) ? asset.type : null,
    bands: bands ? bands.length : null,
    bandNames: names && names.length > 0 ? names.join(", ") : null,
  };
}

/** A STAC bounding box, west, south, east, north, in WGS 84 degrees. */
function bbox(value: JsonValue | undefined): [number, number, number, number] | undefined {
  if (!isJsonArray(value) || value.length < 4) return undefined;
  const numbers = value.slice(0, 4).map((member) => (isJsonNumber(member) && Number.isFinite(member) ? member : undefined));
  const [west, south, east, north] = numbers;
  if (west === undefined || south === undefined || east === undefined || north === undefined) return undefined;
  if (west < -180 || east > 180 || south < -90 || north > 90) return undefined;
  return [round(west), round(south), round(east), round(north)];
}

function pair(value: JsonValue | undefined): [number, number] | undefined {
  if (!isJsonArray(value) || value.length < 2) return undefined;
  const first = value[0];
  const second = value[1];
  if (!isJsonNumber(first) || !isJsonNumber(second) || !Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  return [first, second];
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
