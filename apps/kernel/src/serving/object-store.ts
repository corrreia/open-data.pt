import type { JsonObject } from "@open-data-pt/contract";
import { digest } from "#/hash";
import type { ProductIndexEntry } from "#/registry/feed-model";
import type { SnapshotStore } from "#/serving/ports";

/**
 * JSON objects in R2: the whole serving plane. Record products are immutable
 * content-addressed chunks, listed on their index entry; series and change
 * history are bounded rolling windows, one object per version.
 */
export class ObjectStore {
  constructor(private readonly snapshots: SnapshotStore) {}

  async read<T>(key: string): Promise<T | undefined> {
    const object = await this.snapshots.get(key);
    if (!object) return undefined;
    // SAFETY: every object under this key was written by `write` from the same
    // owner type, and callers read a key back at the type they wrote.
    return JSON.parse(await new Response(object.body).text()) as T;
  }

  async readText(key: string): Promise<string | undefined> {
    const object = await this.snapshots.get(key);
    return object ? new Response(object.body).text() : undefined;
  }

  async write<T>(key: string, value: T): Promise<number> {
    return this.writeText(key, JSON.stringify(value));
  }

  async writeText(key: string, text: string): Promise<number> {
    const bytes = new TextEncoder().encode(text);
    await this.snapshots.putStream(key, bytes, { contentType: "application/json" });
    return bytes.byteLength;
  }

  delete(keys: string[]): Promise<void> {
    return this.snapshots.delete(keys);
  }
}

export const keys = {
  prefix: (feedId: string, slug: string) => `serving/${feedId}/${slug}`,
  changes: (feedId: string, slug: string, version: number) => `serving/${feedId}/${slug}/changes/${version}.json`,
  series: (feedId: string, slug: string, version: number) => `serving/${feedId}/${slug}/series/${version}.json`,
  seriesChanges: (feedId: string, slug: string, version: number) => `serving/${feedId}/${slug}/series-changes/${version}.json`,
};

/** Bumped whenever the Parquet file's columns or metadata change shape: a new layout is a new key, written afresh. */
export const PARQUET_LAYOUT = 1;

/**
 * Where a record product version's Parquet download is kept, once someone has
 * asked for it. The key is a digest of what the file is made of — the layout,
 * the version, the schema and the content-addressed chunks — so it is known
 * from the index entry alone, before the file exists: the runner retires it
 * with the version's chunks, and a reset that reuses a version number never
 * finds another version's file. Undefined for a series, which has no chunks.
 */
export function parquetKey(entry: Pick<ProductIndexEntry, "feedId" | "slug" | "version" | "kind" | "schema" | "chunks">): string | undefined {
  if (entry.kind !== "record" || entry.chunks === null) return undefined;
  const content = JSON.stringify([PARQUET_LAYOUT, entry.version, entry.schema, entry.chunks.map((chunk) => chunk.key)]);
  return `${keys.prefix(entry.feedId, entry.slug)}/parquet/${digest(content)}.parquet`;
}

/** How much rolling history each window keeps; older items live in the lake. */
export const WINDOW = { changes: 500, points: 5_000, pointChanges: 500 };

export interface ChangeItem {
  id: string;
  entityKey: string;
  operation: string;
  payload: JsonObject | null;
  recordHash: string;
  eventTime: string | null;
  validFrom: string | null;
  validTo: string | null;
  sourcePublishedAt: string | null;
  sourceSequence: string | null;
  observedAt: string;
  ingestedAt: string;
  acquisitionId: string;
}

export interface ChangesWindow {
  slug: string;
  updatedAt: string;
  changes: ChangeItem[];
}

export interface PointItem {
  seriesKey: string;
  eventTime: string;
  value: number;
  unit: string;
  dimensions: Record<string, string>;
  observedAt: string;
}

export interface SeriesWindow {
  slug: string;
  updatedAt: string;
  points: PointItem[];
}

export interface PointChangeItem extends PointItem {
  id: string;
  ingestedAt: string;
  acquisitionId: string;
  previousValue: number | null;
}

export interface SeriesChangesWindow {
  slug: string;
  updatedAt: string;
  changes: PointChangeItem[];
}
