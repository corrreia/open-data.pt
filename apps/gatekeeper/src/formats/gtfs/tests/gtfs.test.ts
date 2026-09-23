import { jsonAs, readFixture } from "#/tests/support";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { collectNormalized, GatekeeperError, NORMALIZED_PROTOCOL, resolveFeed, sourceValidator, type CollectionRequest, type NormalizedFrame } from "#/index";
import { collectGtfsFeed, DEFAULT_GTFS_FILES, GTFS_FEEDS, validateGtfsFeedConfig } from "#/formats/gtfs/gtfs";
import { GTFS_NORMALIZER, transformGtfs } from "#/formats/gtfs/transform";
import { gtfsZipEntries, MAX_ARCHIVE_BYTES, type GtfsZipOptions } from "#/formats/gtfs/zip";

const ALLOWED_HOSTS = "api.carrismetropolitana.pt,opendata.porto.digital";
const SOURCE_URL = "https://api.carrismetropolitana.pt/v2/gtfs";

interface ZipEntry {
  name: string;
  text: string;
  method?: 0 | 8;
  descriptor?: boolean;
}

interface GtfsFixture {
  source: string;
  files: Record<string, string>;
}

describe("GTFS Gatekeeper", () => {
  it("normalizes the default files and rejects malformed or denied URLs", () => {
    expect(validateGtfsFeedConfig({ url: SOURCE_URL }, ALLOWED_HOSTS)).toEqual({
      url: SOURCE_URL,
      files: DEFAULT_GTFS_FILES.join(","),
    });
    expect(validateGtfsFeedConfig({ url: SOURCE_URL, files: "routes, agency,routes,shapes" }, ALLOWED_HOSTS)).toEqual({ url: SOURCE_URL, files: "agency,routes,shapes" });
    expect(() => validateGtfsFeedConfig({ url: "http://api.carrismetropolitana.pt/v2/gtfs" }, ALLOWED_HOSTS)).toThrow("must use HTTPS");
    expect(() => validateGtfsFeedConfig({ url: "https://example.com/feed.zip" }, ALLOWED_HOSTS)).toThrow("is not allowed");
    expect(() => validateGtfsFeedConfig({ url: SOURCE_URL, files: "stops,secrets" }, ALLOWED_HOSTS)).toThrow("comma-separated names");
  });

  it("hands the archive body on unread with provenance, completeness, and validators", async () => {
    const archive = zipArchive([{ name: "stops.txt", text: "stop_id\n1\n" }]);
    const fetcher = vi.fn(
      async () =>
        new Response(archive, {
          headers: {
            "Content-Type": "application/zip",
            ETag: '"gtfs-1"',
            "Last-Modified": "Mon, 07 Sep 2026 15:27:33 GMT",
          },
        }),
    );

    const fetched = await collectGtfsFeed({ url: SOURCE_URL }, undefined, ALLOWED_HOSTS, fetcher);
    if (fetched.kind !== "body") throw new Error(`Expected a body, got ${fetched.kind}`);

    expect(fetched.provenance).toEqual({ sourceUrl: SOURCE_URL, sourcePublishedAt: "2026-09-07T15:27:33.000Z" });
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator).toEqual({ etag: '"gtfs-1"', lastModified: "Mon, 07 Sep 2026 15:27:33 GMT" });
    expect(fetched.next).toBeUndefined();
    expect(fetched.exhausted).toBeUndefined();
    expect(new Uint8Array(await new Response(fetched.body).arrayBuffer())).toEqual(archive);
  });

  it("forwards both checkpoint validators and reports not-modified, keeping validators a 304 omits", async () => {
    const fetcher = vi.fn(async (_url: URL | string | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"old"');
      expect(headers.get("if-modified-since")).toBe("Sun, 06 Sep 2026 15:27:33 GMT");
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 304, headers: { ETag: '"old"' } });
    });

    const fetched = await collectGtfsFeed({ url: SOURCE_URL }, { etag: '"old"', lastModified: "Sun, 06 Sep 2026 15:27:33 GMT" }, ALLOWED_HOSTS, fetcher);
    expect(fetched).toEqual({
      kind: "not-modified",
      validator: { etag: '"old"', lastModified: "Sun, 06 Sep 2026 15:27:33 GMT" },
    });
  });

  it("rejects redirects to hosts outside the allowlist", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://downloads.example.com/gtfs.zip" },
        }),
    );
    await expect(collectGtfsFeed({ url: SOURCE_URL }, undefined, ALLOWED_HOSTS, fetcher)).rejects.toThrow("is not allowed");
  });

  it("rejects declared archives above the compressed body cap", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(Uint8Array.of(1), {
          headers: { "Content-Length": String(MAX_ARCHIVE_BYTES + 1) },
        }),
    );
    await expect(collectGtfsFeed({ url: SOURCE_URL }, undefined, ALLOWED_HOSTS, fetcher)).rejects.toMatchObject({
      code: "response-too-large",
      message: `GTFS ZIP exceeded ${MAX_ARCHIVE_BYTES} bytes`,
    });
  });

  it("reports provider errors with their status and Retry-After before touching a body", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503, headers: { "Retry-After": "120" } }));
    const failure = await collectGtfsFeed({ url: SOURCE_URL }, undefined, ALLOWED_HOSTS, fetcher).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(GatekeeperError);
    expect(failure).toMatchObject({
      message: "Source returned HTTP 503",
      code: "upstream-error",
      retryAfterSeconds: 120,
    });
  });

  it("streams the live Metro do Porto archive through the collector in 7-byte chunks", async () => {
    const metro = jsonAs<GtfsFixture>(readFixture(new URL("./fixtures/metro-do-porto.json", import.meta.url)));
    const archive = zipArchive(
      Object.entries(metro.files).map(([name, text], index) => ({
        name: `gtfs/${name}`,
        text,
        descriptor: index % 2 === 1,
      })),
    );
    const resolved = await resolveFeed(
      { url: metro.source, files: "agency,stops,routes,calendar,calendar_dates,trips,shapes,feed_info" },
      { library: "gtfs", kinds: GTFS_FEEDS, validate: (value) => validateGtfsFeedConfig(value, ALLOWED_HOSTS) },
    );
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: "col_gtfs_metro",
      feed: { id: "feed_metro", slug: "metro-do-porto-gtfs-feed", title: "Metro do Porto GTFS", description: "GTFS fixture" },
      resolved,
      feedEpoch: "epoch-1",
      mode: { kind: "live" },
      limits: { sourceBytes: 1024 * 1024, outputBytes: 4 * 1024 * 1024, frameBytes: 256 * 1024, recordBytes: 128 * 1024, records: 10_000, products: 16 },
      deadline: new Date(Date.now() + 60_000).toISOString(),
      observedAt: "2026-09-10T09:00:00.000Z",
    };
    const fetcher = vi.fn(
      async () =>
        new Response(chunked(archive, 7), {
          headers: { ETag: '"metro-1"', "Last-Modified": "Mon, 07 Sep 2026 15:27:33 GMT" },
        }),
    );

    const result = await collectNormalized(request, {
      normalizer: GTFS_NORMALIZER,
      resolve: () => resolved,
      source: (state) => collectGtfsFeed(resolved.config, sourceValidator(state), ALLOWED_HOSTS, fetcher),
      normalize: { kind: "streaming", transform: (body, context) => transformGtfs(body, context) },
    });
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${JSON.stringify(result)}`);
    const frames = (await new Response(result.stream).text())
      .trim()
      .split("\n")
      .map((line) => jsonAs<NormalizedFrame>(line));

    const header = frames[0];
    if (header?.type !== "header") throw new Error("Expected the header frame first");
    expect(header.normalizer).toEqual({ id: "gtfs-schedule", version: "3" });
    expect(header.products.map((product) => product.productKey)).toEqual(["stops", "routes", "agencies", "calendar", "calendar-dates", "trips", "shapes"]);
    expect(header.provenance).toEqual({ sourceUrl: metro.source, sourcePublishedAt: "2026-09-07T15:27:33.000Z" });
    expect(header.completeness).toBe("complete");
    expect(header.checkpoint.state).toEqual({
      validators: { default: { etag: '"metro-1"', lastModified: "Mon, 07 Sep 2026 15:27:33 GMT" } },
    });

    const perProduct = new Map<string, number>();
    for (const frame of frames) {
      if (frame.type === "record") perProduct.set(frame.productKey, (perProduct.get(frame.productKey) ?? 0) + 1);
    }
    expect(Object.fromEntries(perProduct)).toEqual({
      agencies: 1,
      stops: 3,
      routes: 2,
      calendar: 2,
      "calendar-dates": 2,
      trips: 3,
      "shapes": 1,
    });
    expect(frames.at(-1)).toEqual({
      type: "complete",
      counts: { records: 14, points: 0 },
      quality: { acceptedRecords: 14, rejectedRecords: 0 },
    });
  });
});

describe("streaming GTFS ZIP reader", () => {
  it("inflates a deflate entry whose size is only in a trailing data descriptor", async () => {
    const archive = zipArchive([{ name: "stops.txt", text: "stop_id,stop_name\n1,Quoted name\n", descriptor: true }]);
    expect(await readEntries(archive, ["stops.txt"], 7)).toEqual({ "stops.txt": "stop_id,stop_name\n1,Quoted name\n" });
  });

  it("skips unwanted sized, stored, and descriptor entries and reads wanted ones under folders", async () => {
    const archive = zipArchive([
      { name: "feed/stop_times.txt", text: "trip_id\n".repeat(200), descriptor: true },
      { name: "feed/agency.txt", text: "agency_id\nA\n", method: 0 },
      { name: "feed/notes.bin", text: "opaque", method: 0 },
      { name: "feed/STOPS.TXT", text: "stop_id\nS\n" },
    ]);
    expect(await readEntries(archive, ["agency.txt", "stops.txt"], 5)).toEqual({
      "agency.txt": "agency_id\nA\n",
      "stops.txt": "stop_id\nS\n",
    });
  });

  it("stops reading the body once every wanted entry was read", async () => {
    const archive = zipArchive([
      { name: "agency.txt", text: "agency_id\nA\n" },
      { name: "stop_times.txt", text: "trip_id\n".repeat(10_000) },
    ]);
    let cancelled = false;
    let delivered = 0;
    const body = chunked(
      archive,
      16,
      () => {
        cancelled = true;
      },
      (size) => {
        delivered += size;
      },
    );
    for await (const entry of gtfsZipEntries(body, new Set(["agency.txt"]))) {
      for await (const chunk of entry.chunks) expect(chunk.byteLength).toBeGreaterThan(0);
    }
    expect(cancelled).toBe(true);
    expect(delivered).toBeLessThan(archive.byteLength);
  });

  it("fails an entry past its inflated cap, whether sized by its header or by a descriptor", async () => {
    const text = "0123456789".repeat(4);
    for (const descriptor of [false, true]) {
      await expect(readEntries(zipArchive([{ name: "stops.txt", text, descriptor }]), ["stops.txt"], 7, { maximumEntryBytes: 16 })).rejects.toMatchObject({
        code: "response-too-large",
        message: "GTFS entry stops.txt inflates past 16 bytes",
      });
    }
  });

  it("fails a stored entry whose size is only in a data descriptor with a clear error", async () => {
    const archive = zipArchive([{ name: "stops.txt", text: "stop_id\n1\n", method: 0, descriptor: true }]);
    await expect(readEntries(archive, ["stops.txt"], 7)).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("has its size only in a trailing data descriptor"),
    });
  });

  it("fails a data descriptor that disagrees with the inflated entry", async () => {
    const archive = zipArchive([{ name: "stops.txt", text: "stop_id\n1\n", descriptor: true }]);
    // Corrupt the descriptor's uncompressed size, the last word before the central directory.
    archive[archive.byteLength - 8] = (archive[archive.byteLength - 8] ?? 0) + 1;
    await expect(readEntries(archive, ["stops.txt"], 7)).rejects.toMatchObject({
      code: "invalid-response",
      message: "GTFS entry stops.txt data descriptor sizes did not match the entry",
    });
  });
});

async function readEntries(archive: Uint8Array, wanted: string[], chunkSize: number, options?: GtfsZipOptions): Promise<Record<string, string>> {
  const texts: Record<string, string> = {};
  for await (const entry of gtfsZipEntries(chunked(archive, chunkSize), new Set(wanted), options)) {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of entry.chunks) text += decoder.decode(chunk, { stream: true });
    texts[entry.name] = text + decoder.decode();
  }
  return texts;
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

function chunked(bytes: Uint8Array, chunkSize: number, onCancel?: () => void, onDeliver?: (size: number) => void): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + chunkSize);
      offset += chunkSize;
      onDeliver?.(chunk.byteLength);
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel?.();
    },
  });
}
