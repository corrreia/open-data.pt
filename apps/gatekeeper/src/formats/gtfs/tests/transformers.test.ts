import { jsonAs, readFixture } from "#/tests/support";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { CanonicalRecord, ProductDeclaration, StreamingSummary, TransformContext } from "@open-data-pt/contract";
import { GtfsCsvReader } from "#/formats/gtfs/csv";
import { GTFS_NORMALIZER, transformGtfs, type GtfsTransformLimits } from "#/formats/gtfs/transform";

interface GtfsFixture {
  source: string;
  files: Record<string, string>;
}

interface ZipEntry {
  name: string;
  text: string;
  method?: 0 | 8;
  descriptor?: boolean;
}

interface Normalized {
  products: ProductDeclaration[];
  rows: Map<string, CanonicalRecord[]>;
  summary: StreamingSummary;
}

const fixtures = {
  carris: jsonAs<GtfsFixture>(readFixture(new URL("./fixtures/carris-metropolitana.json", import.meta.url))),
  metro: jsonAs<GtfsFixture>(readFixture(new URL("./fixtures/metro-do-porto.json", import.meta.url))),
};

const CARRIS_FILES = "agency,stops,routes,calendar_dates,feed_info";
const METRO_FILES = "agency,stops,routes,calendar,calendar_dates,trips,shapes,feed_info";

function context(slug: string, title: string, files: string, observedAt = "2026-09-07T20:55:26Z"): TransformContext {
  return {
    feed: {
      slug,
      title,
      description: "GTFS fixture",
      config: { url: "https://api.carrismetropolitana.pt/v2/gtfs", files },
      semantics: {
        domainSubject: "reference",
        defaultProductRole: "reference",
      },
    },
    observedAt,
  };
}

/** The fixture's live GTFS files packed as the archive the operator serves. */
function fixtureArchive(fixture: GtfsFixture, entry: (name: string, index: number) => Partial<ZipEntry> = () => ({})): Uint8Array {
  return zipArchive(Object.entries(fixture.files).map(([name, text], index) => ({ name, text, ...entry(name, index) })));
}

async function normalize(archive: Uint8Array, transformContext: TransformContext, chunkSize = 7, limits?: GtfsTransformLimits): Promise<Normalized> {
  const transform = transformGtfs(chunked(archive, chunkSize), transformContext, limits);
  const rows = new Map<string, CanonicalRecord[]>();
  for await (const row of transform.rows) {
    if (!row.record) throw new Error(`GTFS produced a series point for ${row.productKey}`);
    const records = rows.get(row.productKey) ?? [];
    records.push(row.record);
    rows.set(row.productKey, records);
  }
  return { products: transform.products, rows, summary: transform.finish() };
}

describe("GTFS transformer", () => {
  it("streams typed stop, route, agency, and calendar-exception products from the live Carris archive", async () => {
    const result = await normalize(fixtureArchive(fixtures.carris), context("carris-metropolitana-gtfs-feed", "Carris Metropolitana GTFS", CARRIS_FILES));

    expect(GTFS_NORMALIZER).toEqual({ id: "gtfs-schedule", version: "3" });
    expect(result.products.map((product) => product.slug)).toEqual([
      "carris-metropolitana-gtfs-stops",
      "carris-metropolitana-gtfs-routes",
      "carris-metropolitana-gtfs-agencies",
      "carris-metropolitana-gtfs-calendar-dates",
    ]);
    expect(result.products.every((product) => product.role === "reference" && product.kind === "record")).toBe(true);
    expect(result.products.every((product) => product.updateMode === "authoritative-snapshot" && product.completeness === "complete")).toBe(true);

    expect(result.rows.get("stops")?.[0]).toMatchObject({
      entityKey: "100001",
      payload: {
        stop_id: "100001",
        stop_name: "Rua Dom João de Castro 4",
        stop_code: "100001",
        latitude: 38.700532,
        longitude: -8.954064,
        location_type: "Stop or platform (0)",
        wheelchair_boarding: "No information (0)",
      },
    });
    const stops = result.products.find((product) => product.productKey === "stops");
    expect(Object.fromEntries(stops?.schema.fields.map((field) => [field.id, field.type]) ?? [])).toMatchObject({
      stop_id: "identifier",
      latitude: "latitude",
      longitude: "longitude",
      location_type: "category",
    });

    expect(result.rows.get("routes")?.[0]?.payload).toMatchObject({
      route_id: "[LA77N]1001_0",
      route_short_name: "1001",
      route_type: "Bus (3)",
      route_type_code: "3",
      route_color: "#C61D23",
      route_text_color: "#FFFFFF",
      agency_id: "LA77N",
    });
    const routes = result.products.find((product) => product.productKey === "routes");
    expect(routes?.schema.fields.find((field) => field.id === "route_short_name")?.display).toEqual({
      badge: { colorField: "route_color", textColorField: "route_text_color" },
    });
    expect(routes?.schema.fields.find((field) => field.id === "route_color")?.type).toBe("color");

    expect(result.rows.get("calendar-dates")?.[0]).toMatchObject({
      entityKey: "[XS3H8][LA77N]1:2026-01-05",
      payload: { date: "2026-01-05", exception_type: "Service added (1)" },
    });
    expect(result.summary.quality).toEqual({ acceptedRecords: 11, rejectedRecords: 0 });
  });

  it("builds calendars, trips, and ordered LineStrings from the live Metro do Porto archive", async () => {
    // A folder prefix and descriptor-sized entries, as streaming ZIP writers produce.
    const archive = fixtureArchive(fixtures.metro, (name, index) => ({ name: `gtfs/${name}`, descriptor: index % 2 === 0 }));
    const result = await normalize(archive, context("metro-do-porto-gtfs-feed", "Metro do Porto GTFS", METRO_FILES), 3);

    expect(result.rows.get("calendar")?.[0]?.payload).toMatchObject({
      service_id: "BU",
      monday: true,
      saturday: false,
      start_date: "2026-04-06",
      end_date: "2026-07-19",
    });
    expect(result.rows.get("trips")?.[0]).toMatchObject({
      entityKey: "BU0",
      payload: {
        route_id: "B",
        service_id: "BU",
        direction_id: "Outbound (0)",
        wheelchair_accessible: "Accessible (1)",
        "shape_id": "BG",
      },
    });
    expect(result.rows.get("shapes")?.[0]).toMatchObject({
      entityKey: "BG",
      payload: {
        "shape_id": "BG",
        geometry: {
          type: "LineString",
          coordinates: [
            [-8.58241558074951, 41.160717010498],
            [-8.58624458312988, 41.1505355834961],
            [-8.59297752380371, 41.1466979980469],
            [-8.59834861755371, 41.148796081543],
          ],
        },
        point_count: 4,
      },
    });
    expect(result.rows.get("agencies")?.[0]).toMatchObject({
      entityKey: "default",
      payload: { agency_id: "default", agency_name: "Metro do Porto" },
    });
    expect(result.products.find((product) => product.productKey === "shapes")?.schema.fields.find((field) => field.id === "geometry")?.type).toBe("geometry");
    expect(result.summary.quality).toMatchObject({ rejectedRecords: 0 });
  });

  it("is deterministic across chunk sizes and observation clocks", async () => {
    const archive = fixtureArchive(fixtures.metro, (_name, index) => ({ descriptor: index % 3 === 0, method: index === 1 ? 0 : 8 }));
    const first = await normalize(archive, context("test-feed", "Test", METRO_FILES), 1);
    const second = await normalize(archive, context("test-feed", "Test", METRO_FILES, "2030-01-01T00:00:00Z"), 64 * 1024);
    expect(second).toEqual(first);
  });

  it("declares every requested product up front and warns when the archive lacks one", async () => {
    const result = await normalize(
      fixtureArchive(fixtures.carris),
      context("carris-metropolitana-gtfs-feed", "Carris Metropolitana GTFS", "agency,stops,routes,calendar,calendar_dates,feed_info"),
    );
    expect(result.products.map((product) => product.productKey)).toEqual(["stops", "routes", "agencies", "calendar", "calendar-dates"]);
    expect(result.rows.has("calendar")).toBe(false);
    // An absent file says nothing about current state, so the kernel must not treat it as an empty snapshot.
    expect(result.summary.products).toEqual([{ productKey: "calendar", completeness: "unknown" }]);
  });

  it("counts malformed rows, applies the single-agency default only to a lone agency, and never reads stop_times.txt", async () => {
    const archive = zipArchive([
      { name: "agency.txt", text: "agency_id,agency_name,agency_url,agency_timezone\n,First,https://a.example,Europe/Lisbon\nB,Second,https://b.example,Europe/Lisbon\n" },
      { name: "stop_times.txt", text: 'not even,a,valid"csv' },
      { name: "stops.txt", text: "stop_id,stop_name\n,Nameless\nS1,Named\n" },
    ]);
    const result = await normalize(archive, context("test-feed", "Test", "agency,stops,stop_times"));
    expect(result.rows.get("agencies")?.map((record) => record.entityKey)).toEqual(["B"]);
    expect(result.rows.get("stops")?.map((record) => record.entityKey)).toEqual(["S1"]);
    expect(result.summary.quality).toEqual({
      acceptedRecords: 2,
      rejectedRecords: 2,
    });
  });

  it("fails explicitly past the shapes.txt point bound and the per-entry inflated cap", async () => {
    const metro = fixtureArchive(fixtures.metro);
    const metroContext = context("test-feed", "Test", METRO_FILES);
    await expect(normalize(metro, metroContext, 7, { maximumEntryBytes: 1024 * 1024, maximumPathPoints: 3 })).rejects.toMatchObject({
      code: "response-too-large",
      message: "GTFS shapes.txt has more than 3 points to assemble",
    });
    await expect(normalize(metro, metroContext, 7, { maximumEntryBytes: 64, maximumPathPoints: 1000 })).rejects.toMatchObject({ code: "response-too-large" });
  });
});

describe("GTFS CSV reader", () => {
  const text = '\uFEFFid,name,description\r\n1,"A, B","Line 1\nLine ""2"""\r\n';
  const expected = [{ id: "1", name: "A, B", description: 'Line 1\nLine "2"' }];

  it("handles a UTF-8 BOM, CRLF, escaped quotes, commas, and quoted newlines, whole or one character at a time", () => {
    expect(readAll(new GtfsCsvReader(), [text])).toEqual(expected);
    expect(readAll(new GtfsCsvReader(), [...text])).toEqual(expected);
  });

  it("returns a final row without a newline and skips blank lines", () => {
    expect(readAll(new GtfsCsvReader(), ["a,b\n\n1,", "2"])).toEqual([{ a: "1", b: "2" }]);
  });

  it("rejects an unterminated quote, a stray quote, duplicate headers, and runaway rows", () => {
    expect(() => readAll(new GtfsCsvReader(), ['id\n"open'])).toThrow("CSV ended inside a quoted field");
    expect(() => readAll(new GtfsCsvReader(), ['id\nab"c\n'])).toThrow("Quote appeared inside an unquoted field");
    expect(() => readAll(new GtfsCsvReader(), ["id,id\n1,2\n"])).toThrow("non-empty and unique");
    expect(() => readAll(new GtfsCsvReader(8), ["id\n", "0123456789\n"])).toThrow("Row exceeds 8 characters");
  });
});

function readAll(reader: GtfsCsvReader, pieces: string[]): Array<Record<string, string>> {
  return [...pieces.flatMap((piece) => reader.push(piece)), ...reader.finish()];
}

function zipArchive(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = new TextEncoder().encode(entry.text);
    const method = entry.method ?? 8;
    const compressed = method === 0 ? data : new Uint8Array(deflateRawSync(data));
    const descriptor = entry.descriptor ?? false;
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, descriptor ? 0x8 : 0, true);
    header.setUint16(8, method, true);
    header.setUint32(18, descriptor ? 0 : compressed.byteLength, true);
    header.setUint32(22, descriptor ? 0 : data.byteLength, true);
    header.setUint16(26, name.byteLength, true);
    parts.push(new Uint8Array(header.buffer), name, compressed);
    if (descriptor) {
      const trailer = new DataView(new ArrayBuffer(16));
      trailer.setUint32(0, 0x08074b50, true);
      trailer.setUint32(8, compressed.byteLength, true);
      trailer.setUint32(12, data.byteLength, true);
      parts.push(new Uint8Array(trailer.buffer));
    }
  }
  parts.push(Uint8Array.of(0x50, 0x4b, 0x01, 0x02));
  const archive = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.byteLength;
  }
  return archive;
}

function chunked(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}
