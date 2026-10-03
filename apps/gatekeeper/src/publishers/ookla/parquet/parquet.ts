import {
  GatekeeperError,
  fixedOrigin,
  isJsonString,
  readBoundedResponse,
  retryAfterSeconds,
  type Described,
  type FeedKindDescription,
  type HistoryCursor,
  type JsonObject,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
} from "#/index";
import { PORTUGAL } from "./quadkeys";
import { readLayout, rowsInRanges, type RangeReader, type ReadBudget } from "./reader";

/** Ookla's public bucket on Amazon S3, read anonymously over HTTPS. */
export const OOKLA_BUCKET_ORIGIN = "https://ookla-open-data.s3.amazonaws.com";

/** The dataset's documentation, which the product page links to: the files themselves are hundreds of megabytes. */
export const OOKLA_DOCUMENTATION = "https://github.com/teamookla/ookla-open-data";

const MIB = 1024 * 1024;

/**
 * The most one collection reads from the bucket: the footer, and the column
 * chunks of the row groups that hold Portugal, up to its last row. The most
 * any quarter took was 46 MB (fixed, Q3 2021, written as a single row group).
 */
export const OOKLA_MAX_SOURCE_BYTES = 96 * MIB;

/** Portugal has under 50,000 tiles with a test in a quarter; three times that is a file this reader does not understand. */
export const OOKLA_MAX_TILES = 150_000;

/** The listing of one layer's files: some 35 keys, a few hundred bytes each. */
const LISTING_MAX_BYTES = MIB;
const LISTING_MAX_PAGES = 4;

export const OOKLA_FEEDS = {
  // One row per zoom-16 tile per quarter: averages of the tests taken in it, dated by the quarter they were taken in.
  tiles: {
    kind: "tiles",
    semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
    // A slice is one quarter, some 10 to 50 MB of ranged reads from S3: ten minutes apart, the walk back to 2019 takes five hours.
    history: { earliest: "2019-01-01T00:00:00.000Z", minSliceSeconds: 600 },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** The two layers Ookla publishes: tests over a cellular connection, and over any other (Wi-Fi, Ethernet). */
export type OoklaLayer = "fixed" | "mobile";

function isLayer(value: string | undefined): value is OoklaLayer {
  return value === "fixed" || value === "mobile";
}

export function validateParquetFeedConfig(config: SourceConfig): SourceConfig {
  if (config.feed !== "tiles") throw new GatekeeperError("Ookla feeds require feed=tiles", "invalid-config");
  if (!isLayer(config.type)) throw new GatekeeperError("Ookla tile feeds require type=fixed or type=mobile", "invalid-config");
  const unsupported = Object.keys(config).filter((key) => key !== "feed" && key !== "type");
  if (unsupported.length > 0) throw new GatekeeperError(`Ookla feed configuration does not accept ${unsupported.join(", ")}`, "invalid-config");
  return { feed: "tiles", type: config.type };
}

/** The columns a tile row carries, in the order the body lists them after its quadkey. */
export const TILE_COLUMNS = ["avg_d_kbps", "avg_u_kbps", "avg_lat_ms", "avg_lat_down_ms", "avg_lat_up_ms", "tests", "devices"] as const;

/** One quarter's Parquet file of one layer, as the bucket lists it. */
export interface QuarterFile {
  key: string;
  /** The quarter's first instant and the next quarter's, UTC. */
  start: string;
  end: string;
  /** As Ookla names it: "2026-Q2". */
  label: string;
  size: number;
  etag: string;
  lastModified: string;
}

/** What the transform is told about the body it reads: which quarter its tiles are averages of. */
export interface TilesMetadata {
  start: string;
  end: string;
  label: string;
}

const KEY = /^parquet\/performance\/type=(fixed|mobile)\/year=(\d{4})\/quarter=([1-4])\/(\d{4})-(\d{2})-01_performance_(fixed|mobile)_tiles\.parquet$/;

/** The quarter a listed key is the file of, or nothing for anything else the bucket holds (folder markers, other layers). */
export function quarterOf(key: string, layer: OoklaLayer): Pick<QuarterFile, "start" | "end" | "label"> | undefined {
  const match = KEY.exec(key);
  if (!match || match[1] !== layer || match[6] !== layer || match[2] !== match[4]) return undefined;
  const year = Number(match[2]);
  const quarter = Number(match[3]);
  if (Number(match[5]) !== (quarter - 1) * 3 + 1) return undefined;
  return {
    start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)).toISOString(),
    end: new Date(Date.UTC(year, quarter * 3, 1)).toISOString(),
    label: `${year}-Q${quarter}`,
  };
}

/** XML's five entities: S3 writes an ETag's quotes as `&quot;`. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["quot", '"'],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["apos", "'"],
]);

function unescapeXml(text: string): string {
  return text.replace(/&(quot|amp|lt|gt|apos);/g, (_, name: string) => ENTITIES.get(name) ?? "");
}

function element(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match ? unescapeXml(match[1]!) : undefined;
}

/** One page of a ListObjectsV2 answer: every quarter file of the layer it lists, and where the next page starts. */
export interface ListingPage {
  files: QuarterFile[];
  continuation: string | undefined;
}

export function parseListing(xml: string, layer: OoklaLayer): ListingPage {
  if (!/<ListBucketResult[\s>]/.test(xml)) throw new GatekeeperError("Ookla's bucket did not answer with a listing", "invalid-response");
  const files: QuarterFile[] = [];
  for (const [, contents] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = element(contents!, "Key");
    const quarter = key ? quarterOf(key, layer) : undefined;
    if (!key || !quarter) continue;
    const size = Number(element(contents!, "Size"));
    const etag = element(contents!, "ETag");
    const lastModified = element(contents!, "LastModified");
    if (!Number.isSafeInteger(size) || size <= 0 || !etag || !lastModified || Number.isNaN(Date.parse(lastModified)))
      throw new GatekeeperError(`Ookla's listing of ${key} is incomplete`, "invalid-response");
    files.push({ key, ...quarter, size, etag, lastModified: new Date(lastModified).toISOString() });
  }
  const truncated = element(xml, "IsTruncated") === "true";
  const continuation = truncated ? element(xml, "NextContinuationToken") : undefined;
  if (truncated && !continuation) throw new GatekeeperError("Ookla's listing is truncated without a continuation token", "invalid-response");
  return { files, continuation };
}

/** Every quarter file of a layer the bucket lists, oldest first: one request, a second only past a thousand keys. */
export async function listQuarters(origin: string, layer: OoklaLayer, fetcher: typeof fetch): Promise<QuarterFile[]> {
  const files: QuarterFile[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < LISTING_MAX_PAGES; page += 1) {
    const url = new URL("/", origin);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", `parquet/performance/type=${layer}/`);
    if (continuation) url.searchParams.set("continuation-token", continuation);
    const response = await request(fetcher, url, new Headers({ Accept: "application/xml" }));
    if (!response.ok) throw new GatekeeperError(`Ookla's bucket listing returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
    const listed = parseListing(new TextDecoder().decode(await readBoundedResponse(response, LISTING_MAX_BYTES, "Ookla's bucket listing")), layer);
    files.push(...listed.files);
    continuation = listed.continuation;
    if (!continuation) {
      files.sort((left, right) => left.start.localeCompare(right.start));
      for (let index = 1; index < files.length; index += 1)
        if (files[index]!.start === files[index - 1]!.start) throw new GatekeeperError(`Ookla's bucket lists two files for ${files[index]!.label}`, "invalid-response");
      return files;
    }
  }
  throw new GatekeeperError(`Ookla's bucket listing runs past ${LISTING_MAX_PAGES} pages`, "response-too-large");
}

async function request(fetcher: typeof fetch, url: URL, headers: Headers): Promise<Response> {
  try {
    return await fetcher(url, { headers });
  } catch (error) {
    if (error instanceof GatekeeperError) throw error;
    throw new GatekeeperError(`Ookla's bucket did not answer: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
}

/**
 * Ranged reads of one file, each bound to the version the listing named
 * (`If-Match`), so a file Ookla replaces halfway through a read fails the
 * collection instead of mixing two versions.
 */
export function rangeReader(origin: string, file: QuarterFile, fetcher: typeof fetch): RangeReader {
  const url = new URL(`/${file.key}`, origin);
  return async (start, length) => {
    const end = start + length - 1;
    const response = await request(fetcher, url, new Headers({ Range: `bytes=${start}-${end}`, "If-Match": file.etag }));
    if (response.status === 412) {
      await response.body?.cancel();
      throw new GatekeeperError(`Ookla replaced ${file.key} while it was being read`, "upstream-error");
    }
    if (response.status !== 206 || !response.body) {
      await response.body?.cancel();
      throw new GatekeeperError(`Ookla's bucket answered a range of ${file.key} with HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
    }
    if (response.headers.get("content-range") !== `bytes ${start}-${end}/${file.size}`) {
      await response.body.cancel();
      throw new GatekeeperError(`Ookla's bucket answered another range of ${file.key} than the one asked for`, "invalid-response");
    }
    return response.body;
  };
}

/** A quarter's Portuguese tiles as the transform reads them, and what reading them costs. */
export interface TileBody {
  body: ReadableStream<Uint8Array>;
  /** What the read has cost so far: it grows as the body is read. */
  budget: ReadBudget;
}

/**
 * The tiles of one quarter's file that fall on Portugal, as a stream of JSON
 * lines read only as the transform asks for them: `[quadkey, ...TILE_COLUMNS]`,
 * null where the file has no value. The footer is read before the stream is
 * handed out, so a file this reader cannot read fails the collection before
 * anything is declared.
 */
export async function portugalTiles(origin: string, file: QuarterFile, fetcher: typeof fetch): Promise<TileBody> {
  const read = rangeReader(origin, file, fetcher);
  const budget: ReadBudget = { remainingBytes: OOKLA_MAX_SOURCE_BYTES, maxRows: OOKLA_MAX_TILES, requests: 0, bytes: 0 };
  const layout = await readLayout(read, file.size, budget);
  const groups = rowsInRanges(read, layout, PORTUGAL, TILE_COLUMNS, budget);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await groups.next();
      if (next.done) {
        controller.close();
        return;
      }
      // One row group's tiles at a time, in slices small enough that no one chunk is large.
      for (let start = 0; start < next.value.length; start += 1000) {
        const lines = next.value.slice(start, start + 1000).map((row) => `${JSON.stringify([row.quadkey, ...row.values])}\n`);
        controller.enqueue(encoder.encode(lines.join("")));
      }
    },
    async cancel() {
      await groups.return(undefined);
    },
  });
  return { body, budget };
}

/**
 * The newest quarter of a layer: one listing, and nothing more when it is the
 * file (and the version of it) the last collection read. Ookla adds a quarter
 * a few weeks after it ends, and may write one again to honour a data subject's
 * request, which the version tells.
 */
export async function collectLatestTiles(
  config: SourceConfig,
  state: JsonObject | undefined,
  origin: string,
  fetcher: typeof fetch,
): Promise<SourceFetch | Described<TilesMetadata>> {
  const layer = layerOf(config);
  const bucket = fixedOrigin(origin, OOKLA_BUCKET_ORIGIN);
  const files = await listQuarters(bucket, layer, fetcher);
  const newest = files.at(-1);
  if (!newest) throw new GatekeeperError(`Ookla's bucket lists no ${layer} quarter`, "invalid-response");
  // The state a live collection leaves: which file it read, and which version of it.
  if (isJsonString(state?.key) && isJsonString(state.etag) && state.key === newest.key && state.etag === newest.etag) return { kind: "not-modified" };
  return read(bucket, newest, fetcher, { state: { key: newest.key, etag: newest.etag } });
}

/** One quarter older than the cursor: the walk back goes a quarter a slice, to the first Ookla published (Q1 2019). */
export async function collectTilesBefore(config: SourceConfig, cursor: HistoryCursor, origin: string, fetcher: typeof fetch): Promise<SourceFetch | Described<TilesMetadata>> {
  const layer = layerOf(config);
  if (cursor.offset !== undefined || cursor.token !== undefined) throw new GatekeeperError("Ookla history only accepts a before cursor", "invalid-config");
  const before = Date.parse(cursor.before);
  if (Number.isNaN(before)) throw new GatekeeperError("Ookla history cursor must be a timestamp", "invalid-config");
  const bucket = fixedOrigin(origin, OOKLA_BUCKET_ORIGIN);
  const files = (await listQuarters(bucket, layer, fetcher)).filter((file) => Date.parse(file.start) < before);
  const file = files.at(-1);
  if (!file) return { kind: "exhausted" };
  const older = files.at(-2);
  return read(bucket, file, fetcher, older ? { state: {}, next: { before: file.start } } : { state: {}, exhausted: true });
}

function layerOf(config: SourceConfig): OoklaLayer {
  const validated = validateParquetFeedConfig(config);
  if (!isLayer(validated.type)) throw new GatekeeperError("Ookla tile feeds require type=fixed or type=mobile", "invalid-config");
  return validated.type;
}

async function read(origin: string, file: QuarterFile, fetcher: typeof fetch, progress: Pick<SourceBody, "state" | "next" | "exhausted">): Promise<Described<TilesMetadata>> {
  const { body } = await portugalTiles(origin, file, fetcher);
  return {
    fetch: {
      kind: "body",
      body,
      provenance: { sourceUrl: OOKLA_DOCUMENTATION, sourcePublishedAt: file.lastModified },
      // Every row group that can hold a Portugal tile is read, up to its last one.
      completeness: "complete",
      ...progress,
    },
    metadata: { start: file.start, end: file.end, label: file.label },
  };
}
