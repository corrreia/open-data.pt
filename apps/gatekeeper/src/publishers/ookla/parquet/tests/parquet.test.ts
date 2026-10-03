import { describe, expect, it } from "vitest";
import { feedCollection } from "#/tests/catalog";
import { jsonAs, readFixture, readFixtureBytes } from "#/tests/support";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  parseJson,
  type CollectionRequest,
  type CollectionResult,
  type JsonObject,
  type ResolvedFeed,
  type SourceCheckpoint,
  type TransformContext,
} from "#/index";
import { OOKLA_BUCKET_ORIGIN, TILES_TRANSFORMER, parseListing, validateParquetFeedConfig } from "#/publishers/ookla/parquet/index";

const SLUG = "ookla-fixed-broadband-performance-feed";

/** The bucket's real listing of the fixed layer on 3 October 2026: Q1 2019 to Q2 2026, and one folder marker. */
const LISTING = readFixture(new URL("./fixtures/listing-fixed.xml", import.meta.url));
/** Made-up tiles laid out as Ookla's files are (see reader.test.ts), with the Portuguese ones listed beside them. */
const ARROW = readFixtureBytes(new URL("./fixtures/tiles-arrow.parquet", import.meta.url));
const LEGACY = readFixtureBytes(new URL("./fixtures/tiles-legacy.parquet", import.meta.url));
const ARROW_EXPECTED = jsonAs<{ portugal: (string | number | null)[][] }>(readFixtureBytes(new URL("./fixtures/tiles-arrow.expected.json", import.meta.url)));

const Q2_2026 = "parquet/performance/type=fixed/year=2026/quarter=2/2026-04-01_performance_fixed_tiles.parquet";
const Q1_2026 = "parquet/performance/type=fixed/year=2026/quarter=1/2026-01-01_performance_fixed_tiles.parquet";
const Q1_2019 = "parquet/performance/type=fixed/year=2019/quarter=1/2019-01-01_performance_fixed_tiles.parquet";
const Q2_2026_ETAG = '"d1abd67619e86a90d868b499e1bfb080"';

/**
 * The bucket as S3 answers it: the saved listing, with the files a test serves standing in for the real ones at
 * their keys (the listing gives their sizes), and ranges of them only for the version the listing names.
 */
function bucket(files: ReadonlyMap<string, Uint8Array>, options: { etag?: string; ignoreRange?: boolean } = {}) {
  const requested: { url: URL; headers: Headers }[] = [];
  const etags = new Map<string, string>();
  const listing = LISTING.replace(/<Contents>([\s\S]*?)<\/Contents>/g, (contents: string) => {
    const key = /<Key>([^<]*)<\/Key>/.exec(contents)?.[1] ?? "";
    const rewritten = key === Q2_2026 ? options.etag : undefined;
    const listed = rewritten ? contents.replace(/<ETag>[^<]*<\/ETag>/, `<ETag>${rewritten.replaceAll('"', "&quot;")}</ETag>`) : contents;
    etags.set(key, /<ETag>([^<]*)<\/ETag>/.exec(listed)?.[1]?.replaceAll("&quot;", '"') ?? "");
    const file = files.get(key);
    return file ? listed.replace(/<Size>\d+<\/Size>/, `<Size>${file.byteLength}</Size>`) : listed;
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    requested.push({ url, headers });
    if (url.origin !== OOKLA_BUCKET_ORIGIN) return new Response("Not Found", { status: 404 });
    if (url.pathname === "/") return new Response(listing, { headers: { "Content-Type": "application/xml" } });
    const key = decodeURIComponent(url.pathname.slice(1));
    const file = files.get(key);
    if (!file) return new Response("NoSuchKey", { status: 404 });
    if (headers.get("if-match") !== etags.get(key)) return new Response("PreconditionFailed", { status: 412 });
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
    if (!range || options.ignoreRange) return new Response(file, { status: 200 });
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), file.byteLength - 1);
    return new Response(file.slice(start, end + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${file.byteLength}` } });
  };
  return { fetcher, requested };
}

function request(resolved: ResolvedFeed, mode: CollectionRequest["mode"], checkpoint?: SourceCheckpoint, observedAt = "2026-10-03T12:00:00.000Z"): CollectionRequest {
  const value: CollectionRequest = {
    protocol: NORMALIZED_PROTOCOL,
    slug: SLUG,
    configHash: resolved.configHash,
    mode,
    limits: { sourceBytes: 96 * 1024 * 1024, outputBytes: 64 * 1024 * 1024, recordBytes: 2048, records: 150_000 },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    observedAt,
  };
  if (checkpoint) value.checkpoint = checkpoint;
  return value;
}

async function frames(result: CollectionResult): Promise<JsonObject[]> {
  if (result.kind !== "batch") throw new Error(`Expected a batch, got ${JSON.stringify(result)}`);
  return (await new Response(result.stream).text())
    .trim()
    .split("\n")
    .map((line) => {
      const frame = parseJson(line);
      if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
      return frame;
    });
}

function records(all: JsonObject[]): JsonObject[] {
  return all.filter((frame) => frame.type === "record").map((frame) => (isJsonObject(frame.value) ? frame.value : {}));
}

describe("Ookla's fixed-broadband tiles", () => {
  it("reads the newest quarter's tiles over Portugal, one row each, dated by the quarter", async () => {
    const { fetcher, requested } = bucket(new Map([[Q2_2026, ARROW]]));
    const { resolved, collector } = await feedCollection(SLUG, { fetcher });
    const all = await frames(await collectNormalized(request(resolved, { kind: "live" }), collector));

    expect(all[0]).toMatchObject({
      type: "header",
      products: [
        {
          productKey: "tiles",
          slug: "ookla-fixed-broadband-performance",
          kind: "record",
          role: "current-state",
          updateMode: "authoritative-snapshot",
          completeness: "complete",
          watermark: "2026-04-01T00:00:00.000Z",
        },
      ],
      provenance: { sourceUrl: "https://github.com/teamookla/ookla-open-data", sourcePublishedAt: "2026-08-19T21:49:29.000Z" },
      checkpoint: { state: { key: Q2_2026, etag: Q2_2026_ETAG } },
    });
    const rows = records(all);
    expect(rows.map((row) => row.entityKey)).toEqual(ARROW_EXPECTED.portugal.map((line) => line[0]));
    const [quadkey, download, upload, latency, downloadLatency, uploadLatency, tests, devices] = ARROW_EXPECTED.portugal[0]!;
    expect(rows[0]).toMatchObject({
      entityKey: quadkey,
      eventTime: "2026-04-01T00:00:00.000Z",
      validFrom: "2026-04-01T00:00:00.000Z",
      validTo: "2026-07-01T00:00:00.000Z",
      payload: {
        quadkey,
        quarter: "2026-Q2",
        region: "Mainland",
        download_kbps: download,
        upload_kbps: upload,
        latency_ms: latency,
        download_latency_ms: downloadLatency,
        upload_latency_ms: uploadLatency,
        tests,
        devices,
      },
    });
    const regions = new Set(rows.map((row) => (isJsonObject(row.payload) ? row.payload.region : undefined)));
    expect(regions).toEqual(new Set(["Mainland", "Madeira", "Azores"]));
    expect(all.at(-1)).toMatchObject({ type: "complete", quality: { acceptedRecords: 270, rejectedRecords: 0 } });

    // One listing, then the footer and the chunks of the row groups that hold Portugal, each bound to the listed version.
    expect(requested[0]?.url.searchParams.get("prefix")).toBe("parquet/performance/type=fixed/");
    const ranges = requested.slice(1);
    expect(ranges.length).toBeGreaterThan(1);
    expect(
      ranges.every(({ url, headers }) => url.pathname === `/${Q2_2026}` && headers.get("if-match") === Q2_2026_ETAG && /^bytes=\d+-\d+$/.test(headers.get("range") ?? "")),
    ).toBe(true);
  });

  it("answers unchanged from the listing alone when the newest quarter is the one already read", async () => {
    const { fetcher, requested } = bucket(new Map([[Q2_2026, ARROW]]));
    const { resolved, collector } = await feedCollection(SLUG, { fetcher });
    const checkpoint = { normalizer: collector.normalizer, state: { key: Q2_2026, etag: Q2_2026_ETAG } };
    const result = await collectNormalized(request(resolved, { kind: "live" }, checkpoint), collector);
    expect(result.kind).toBe("unchanged");
    expect(requested).toHaveLength(1);

    // Ookla writing the quarter again, to honour a data subject's request, is a new version: it is read again.
    const rewritten = bucket(new Map([[Q2_2026, ARROW]]), { etag: '"rewritten"' });
    const again = await feedCollection(SLUG, { fetcher: rewritten.fetcher });
    const reread = await frames(await collectNormalized(request(again.resolved, { kind: "live" }, checkpoint), again.collector));
    expect(records(reread)).toHaveLength(270);
  });

  it("dates rows by the quarter, never by when they were read", async () => {
    const read = async (observedAt: string) => {
      const { fetcher } = bucket(new Map([[Q2_2026, ARROW]]));
      const { resolved, collector } = await feedCollection(SLUG, { fetcher });
      return records(await frames(await collectNormalized(request(resolved, { kind: "live" }, undefined, observedAt), collector)));
    };
    expect(await read("2026-10-03T12:00:00.000Z")).toEqual(await read("2027-01-15T08:30:00.000Z"));
  });

  it("walks back a quarter a slice, to the first quarter of 2019", async () => {
    const { fetcher, requested } = bucket(
      new Map([
        [Q1_2026, ARROW],
        [Q1_2019, LEGACY],
      ]),
    );
    const { resolved, collector } = await feedCollection(SLUG, { fetcher });

    const slice = await frames(await collectNormalized(request(resolved, { kind: "history", cursor: { before: "2026-04-01T00:00:00.000Z" } }), collector));
    expect(requested.slice(1).every(({ url }) => url.pathname === `/${Q1_2026}`)).toBe(true);
    expect(records(slice)[0]).toMatchObject({ eventTime: "2026-01-01T00:00:00.000Z", validTo: "2026-04-01T00:00:00.000Z", payload: { quarter: "2026-Q1" } });
    expect(slice.at(-1)).toMatchObject({ type: "complete", nextCursor: { before: "2026-01-01T00:00:00.000Z" } });

    const first = await frames(await collectNormalized(request(resolved, { kind: "history", cursor: { before: "2019-04-01T00:00:00.000Z" } }), collector));
    const oldest = records(first);
    expect(oldest[0]).toMatchObject({ eventTime: "2019-01-01T00:00:00.000Z", payload: { quarter: "2019-Q1", download_latency_ms: null, upload_latency_ms: null } });
    expect(first.at(-1)).toMatchObject({ type: "complete", exhausted: true });

    const past = await collectNormalized(request(resolved, { kind: "history", cursor: { before: "2019-01-01T00:00:00.000Z" } }), collector);
    expect(past).toEqual({ kind: "exhausted" });
  });

  it("fails, to be tried again, when the file changes while it is read or the bucket ignores the range", async () => {
    const replaced = bucket(new Map([[Q2_2026, ARROW]]));
    const { resolved, collector } = await feedCollection(SLUG, {
      fetcher: async (input, init) => {
        const headers = new Headers(init?.headers);
        // The listing named one version; every range asks for another, as if the file was replaced in between.
        if (headers.has("if-match")) headers.set("If-Match", '"older"');
        return replaced.fetcher(input, { ...init, headers });
      },
    });
    expect(await collectNormalized(request(resolved, { kind: "live" }), collector)).toMatchObject({ kind: "failure", code: "upstream-error", retryable: true });

    const whole = bucket(new Map([[Q2_2026, ARROW]]), { ignoreRange: true });
    const again = await feedCollection(SLUG, { fetcher: whole.fetcher });
    expect(await collectNormalized(request(again.resolved, { kind: "live" }), again.collector)).toMatchObject({ kind: "failure", code: "upstream-error" });
  });

  it("fails when the bucket refuses the listing", async () => {
    const { resolved, collector } = await feedCollection(SLUG, { fetcher: async () => new Response("SlowDown", { status: 503, headers: { "Retry-After": "30" } }) });
    expect(await collectNormalized(request(resolved, { kind: "live" }), collector)).toEqual({ kind: "failure", code: "upstream-error", retryable: true, retryAfterSeconds: 30 });
  });
});

describe("The bucket's listing", () => {
  it("names every quarter of the layer, oldest first, and nothing else the bucket holds", () => {
    const { files, continuation } = parseListing(LISTING, "fixed");
    expect(continuation).toBeUndefined();
    expect(files).toHaveLength(30);
    expect(files[0]).toMatchObject({ key: Q1_2019, label: "2019-Q1", start: "2019-01-01T00:00:00.000Z", end: "2019-04-01T00:00:00.000Z" });
    expect(files.at(-1)).toEqual({
      key: Q2_2026,
      label: "2026-Q2",
      start: "2026-04-01T00:00:00.000Z",
      end: "2026-07-01T00:00:00.000Z",
      size: 353_986_294,
      etag: Q2_2026_ETAG,
      lastModified: "2026-08-19T21:49:29.000Z",
    });
    // A listing of the other layer holds none of this one's files.
    expect(parseListing(LISTING, "mobile").files).toHaveLength(0);
    expect(() => parseListing("<Error><Code>AccessDenied</Code></Error>", "fixed")).toThrow(/listing/);
  });

  it("accepts only the fixed and mobile layers", () => {
    expect(validateParquetFeedConfig({ feed: "tiles", type: "mobile" })).toEqual({ feed: "tiles", type: "mobile" });
    expect(() => validateParquetFeedConfig({ feed: "tiles", type: "satellite" })).toThrow(/type=fixed or type=mobile/);
    expect(() => validateParquetFeedConfig({ feed: "tiles", type: "fixed", year: "2026" })).toThrow(/year/);
  });
});

describe("The tiles' rows", () => {
  it("keep Portugal's tiles once each, with every average a tile must have", async () => {
    const context: TransformContext = {
      feed: {
        slug: SLUG,
        title: "Fixed",
        description: "Fixed",
        config: { feed: "tiles", type: "fixed" },
        semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
      },
      observedAt: "2026-10-03T12:00:00.000Z",
    };
    const lisbon = "0331102110020222";
    const lines = [
      [lisbon, 120000, 30000, 12, null, 40, 9, 3],
      [lisbon, 1, 1, 1, null, null, 1, 1], // the same tile again
      ["0331110121011330", 1, 1, 1, null, null, 1, 1], // Madrid
      ["0331102110020223", null, 1, 1, null, null, 1, 1], // no download average
      ["0331102110020233", 1, 1, -1, null, null, 1, 1], // a negative latency
    ];
    const body = new Response(lines.map((line) => JSON.stringify(line)).join("\n")).body!;
    const transform = TILES_TRANSFORMER.transform(body, context, { start: "2026-04-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z", label: "2026-Q2" });
    const kept = [];
    for await (const row of transform.rows) kept.push(row.record);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.payload).toMatchObject({ quadkey: lisbon, download_latency_ms: null, upload_latency_ms: 40, region: "Mainland" });
    expect(transform.finish().quality).toEqual({ acceptedRecords: 1, rejectedRecords: 4 });
    expect(() => TILES_TRANSFORMER.transform(new Response("").body!, context, undefined)).toThrow(/quarter/);
  });
});
