import { NormalizedInputError, isProductSlug } from "@open-data-pt/gatekeeper-shared";
import type { CollectionPolicyDefinition, FeedSemantics, JsonObject, ResolvedFeed, ServingPolicyDefinition, SourceConfig } from "@open-data-pt/gatekeeper-shared";
import type { ManifestChunk } from "./chunks";
import { feedDefinition, type Acquisition, type Feed, type FeedPolicy, type FeedStatus, type ProductIndexEntry, type ProductSummary } from "./feed-model";
import { dropAllTables, userTables } from "./sqlite-reset";

/**
 * SQLite inside the Registry Durable Object: feed definitions, policies, a
 * mirror of each runner's status and recent acquisitions, slug ownership, and
 * the atomically selected product index the public API reads.
 */
export const REGISTRY_SCHEMA_VERSION = 201;
const ACTIVITY_KEEP = 5_000;

export class RegistryStore {
  constructor(private readonly sql: SqlStorage) {}

  /** A different schema version resets the Registry; the one terminology cleanup below preserves the current schema's data in place. */
  migrate(): void {
    const tables = userTables(this.sql);
    const current = tables.includes("meta") ? this.rows<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`)[0]?.value : undefined;
    if (tables.length > 0 && current !== String(REGISTRY_SCHEMA_VERSION)) {
      console.warn(JSON.stringify({ event: "registry_schema_reset", from: current ?? null, to: REGISTRY_SCHEMA_VERSION }));
      dropAllTables(this.sql);
    }
    this.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.exec(`CREATE TABLE IF NOT EXISTS registry_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`);
    // A sync queue is ephemeral: if it still has the old `kind` field, discard its at-most-four pending operations and rebuild it immediately with `library`.
    this.exec(`UPDATE registry_state SET value_json = json_set(value_json, '$.queue', json('[]'), '$.nextCheckAt', 0)
      WHERE key = 'example-sync' AND EXISTS (SELECT 1 FROM json_each(value_json, '$.queue') WHERE json_type(value, '$.kind') = 'text')`);
    this.exec(`CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, collection_json TEXT NOT NULL, serving_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(name, version))`);
    this.exec(`CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, definition_json TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES policies(id), enabled INTEGER NOT NULL, title TEXT NOT NULL)`);
    // One-time terminology cleanup: old definitions called their library `gatekeeperKind`. Rewrite the JSON in place before any feed is read.
    this.exec(`UPDATE feeds SET definition_json = json_remove(json_set(definition_json, '$.library', json_extract(definition_json, '$.gatekeeperKind')), '$.gatekeeperKind')
      WHERE json_type(definition_json, '$.library') IS NULL AND json_type(definition_json, '$.gatekeeperKind') = 'text'`);
    this.exec(`CREATE TABLE IF NOT EXISTS feed_status (feed_id TEXT PRIMARY KEY, status_json TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.exec(`CREATE TABLE IF NOT EXISTS claims (slug TEXT PRIMARY KEY, feed_id TEXT NOT NULL)`);
    // The chunk list is its own column, last, so product lists never read it.
    this.exec(`CREATE TABLE IF NOT EXISTS products (
      slug TEXT PRIMARY KEY, feed_id TEXT NOT NULL, product_key TEXT NOT NULL, title TEXT NOT NULL, entry_json TEXT NOT NULL, chunks_json TEXT, UNIQUE(feed_id, product_key))`);
    this.exec(`CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, at TEXT NOT NULL, item_json TEXT NOT NULL)`);
    this.exec(`CREATE INDEX IF NOT EXISTS activity_at ON activity (at DESC)`);
    this.exec(`CREATE TABLE IF NOT EXISTS backfills (feed_id TEXT PRIMARY KEY, library TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    const backfillColumns = this.rows<{ name: string }>(`SELECT name FROM pragma_table_info('backfills')`).map((row) => row.name);
    if (backfillColumns.includes("gatekeeper_kind")) this.exec(`ALTER TABLE backfills RENAME COLUMN gatekeeper_kind TO library`);
    // One row per stretch of time a feed's live collection kept failing, or (feed_id '') the platform stopped collecting.
    // A table added here needs no version change: CREATE IF NOT EXISTS adds it to a live Registry on its next start.
    this.exec(`CREATE TABLE IF NOT EXISTS outages (
      id INTEGER PRIMARY KEY, feed_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, cause TEXT NOT NULL, failures INTEGER NOT NULL, last_error TEXT)`);
    this.exec(`CREATE INDEX IF NOT EXISTS outages_started ON outages (started_at)`);
    this.exec(`CREATE UNIQUE INDEX IF NOT EXISTS outages_open ON outages (feed_id) WHERE ended_at IS NULL`);
    // Every construction runs this; writing the version only when it is new keeps a warm-up free of row writes.
    if (current !== String(REGISTRY_SCHEMA_VERSION))
      this.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(REGISTRY_SCHEMA_VERSION));
  }

  getState<T>(key: string): T | undefined {
    const row = this.rows<{ value_json: string }>(`SELECT value_json FROM registry_state WHERE key = ?`, key)[0];
    // SAFETY: values are read under the same owner key and type used by setState.
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }

  setState<T>(key: string, value: T): void {
    this.exec(`INSERT INTO registry_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`, key, JSON.stringify(value));
  }

  /* ---------- Policies ---------- */

  upsertPolicy(policy: FeedPolicy): void {
    this.exec(
      `INSERT INTO policies (id, name, version, collection_json, serving_json, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, collection_json = excluded.collection_json, serving_json = excluded.serving_json`,
      policy.id,
      policy.name,
      policy.version,
      JSON.stringify(policy.collection),
      JSON.stringify(policy.serving),
      policy.createdAt,
    );
  }

  getPolicy(id: string): FeedPolicy | undefined {
    const row = this.rows<PolicyRow>(`SELECT * FROM policies WHERE id = ?`, id)[0];
    return row ? mapPolicy(row) : undefined;
  }

  /** A policy by the pair the table keeps unique, whatever id it was installed under. */
  getPolicyByName(name: string, version: number): FeedPolicy | undefined {
    const row = this.rows<PolicyRow>(`SELECT * FROM policies WHERE name = ? AND version = ?`, name, version)[0];
    return row ? mapPolicy(row) : undefined;
  }

  listPolicies(): FeedPolicy[] {
    return this.rows<PolicyRow>(`SELECT * FROM policies ORDER BY name, version`).map(mapPolicy);
  }

  /* ---------- Feeds ---------- */

  upsertFeed(feed: Feed): void {
    const definition = feedDefinition(feed);
    this.exec(
      `INSERT INTO feeds (id, slug, definition_json, policy_id, enabled, title) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, definition_json = excluded.definition_json, policy_id = excluded.policy_id, enabled = excluded.enabled, title = excluded.title`,
      feed.id,
      feed.slug,
      JSON.stringify(definition),
      feed.policyId,
      feed.enabled ? 1 : 0,
      feed.title,
    );
  }

  getFeed(id: string): Feed | undefined {
    const row = this.rows<FeedRow>(`SELECT f.definition_json, s.status_json FROM feeds f LEFT JOIN feed_status s ON s.feed_id = f.id WHERE f.id = ?`, id)[0];
    return row ? mapFeed(row) : undefined;
  }

  getFeedBySlug(slug: string): Feed | undefined {
    const row = this.rows<FeedRow>(`SELECT f.definition_json, s.status_json FROM feeds f LEFT JOIN feed_status s ON s.feed_id = f.id WHERE f.slug = ?`, slug)[0];
    return row ? mapFeed(row) : undefined;
  }

  listFeeds(): Feed[] {
    return this.rows<FeedRow>(`SELECT f.definition_json, s.status_json FROM feeds f LEFT JOIN feed_status s ON s.feed_id = f.id ORDER BY f.title`).map(mapFeed);
  }

  /** Forget a retired feed: its definition, status, products, slug claims, activity and backfill row. */
  deleteFeed(feedId: string): void {
    this.exec(`DELETE FROM products WHERE feed_id = ?`, feedId);
    this.exec(`DELETE FROM claims WHERE feed_id = ?`, feedId);
    this.exec(`DELETE FROM feed_status WHERE feed_id = ?`, feedId);
    this.exec(`DELETE FROM activity WHERE feed_id = ?`, feedId);
    this.exec(`DELETE FROM backfills WHERE feed_id = ?`, feedId);
    this.exec(`DELETE FROM outages WHERE feed_id = ?`, feedId);
    this.exec(`DELETE FROM feeds WHERE id = ?`, feedId);
  }

  setFeedStatus(feedId: string, status: FeedStatus, now: string): void {
    this.exec(
      `INSERT INTO feed_status (feed_id, status_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(feed_id) DO UPDATE SET status_json = excluded.status_json, updated_at = excluded.updated_at WHERE feed_status.status_json != excluded.status_json`,
      feedId,
      JSON.stringify(status),
      now,
    );
  }

  /* ---------- Products ---------- */

  /** One all-or-none ownership claim before any serving object is written. */
  claimProducts(feedId: string, slugs: string[]): void {
    if (!this.getFeed(feedId)) throw new NormalizedInputError(`Unknown product owner feed ${feedId}`);
    if (slugs.length > 64 || new Set(slugs).size !== slugs.length || !slugs.every(isProductSlug)) throw new NormalizedInputError("Invalid or duplicate product slugs");
    const owners = this.rows<{ slug: string; feed_id: string }>(`SELECT slug, feed_id FROM claims WHERE slug IN (SELECT value FROM json_each(?))`, JSON.stringify(slugs));
    for (const owner of owners) {
      if (owner.feed_id !== feedId) throw new NormalizedInputError(`Product ${owner.slug} belongs to feed ${owner.feed_id}, not ${feedId}`);
    }
    const unclaimed = slugs.filter((slug) => !owners.some((owner) => owner.slug === slug));
    if (unclaimed.length === 0) return;
    this.exec(`INSERT INTO claims (slug, feed_id) SELECT value, ? FROM json_each(?) WHERE 1 ON CONFLICT(slug) DO NOTHING`, feedId, JSON.stringify(unclaimed));
  }

  /** Replace a feed's complete product set. Caller wraps this in one transaction. */
  replaceFeedProducts(feedId: string, entries: ProductIndexEntry[]): void {
    if (entries.some((entry) => entry.feedId !== feedId)) throw new NormalizedInputError("Publication contains mixed feed owners");
    this.claimProducts(
      feedId,
      entries.map((entry) => entry.slug),
    );
    const keep = entries.map((entry) => entry.slug);
    this.exec(`DELETE FROM products WHERE feed_id = ? AND slug NOT IN (SELECT value FROM json_each(?))`, feedId, JSON.stringify(keep));
    for (const entry of entries) {
      const { chunks, ...summary } = entry;
      this.exec(
        `INSERT INTO products (slug, feed_id, product_key, title, entry_json, chunks_json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET product_key = excluded.product_key, title = excluded.title, entry_json = excluded.entry_json, chunks_json = excluded.chunks_json
         WHERE products.entry_json != excluded.entry_json OR products.chunks_json IS NOT excluded.chunks_json`,
        entry.slug,
        feedId,
        entry.productKey,
        entry.title,
        JSON.stringify(summary),
        chunks ? JSON.stringify(chunks) : null,
      );
    }
  }

  getProductBySlug(slug: string): ProductIndexEntry | undefined {
    const row = this.rows<{ entry_json: string; chunks_json: string | null }>(`SELECT entry_json, chunks_json FROM products WHERE slug = ?`, slug)[0];
    if (!row) return undefined;
    // SAFETY: both columns are written by replaceFeedProducts from one ProductIndexEntry.
    return { ...(JSON.parse(row.entry_json) as ProductSummary), chunks: row.chunks_json ? (JSON.parse(row.chunks_json) as ManifestChunk[]) : null };
  }

  listProducts(): ProductSummary[] {
    // SAFETY: entry_json is written only from ProductIndexEntry values, without their chunks, by replaceFeedProducts.
    return this.rows<{ entry_json: string }>(`SELECT entry_json FROM products ORDER BY title`).map((row) => JSON.parse(row.entry_json) as ProductSummary);
  }

  /* ---------- Activity mirror ---------- */

  upsertActivity(id: string, feedId: string, at: string, item: Acquisition): void {
    this.exec(
      `INSERT INTO activity (id, feed_id, at, item_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET at = excluded.at, item_json = excluded.item_json WHERE activity.item_json != excluded.item_json`,
      id,
      feedId,
      at,
      JSON.stringify(item),
    );
  }

  pruneActivity(): void {
    this.exec(`DELETE FROM activity WHERE at < COALESCE((SELECT at FROM activity ORDER BY at DESC LIMIT 1 OFFSET ?), '')`, ACTIVITY_KEEP);
  }

  listActivity(limit: number, feedId?: string): Acquisition[] {
    const rows = feedId
      ? this.rows<{ item_json: string }>(`SELECT item_json FROM activity WHERE feed_id = ? ORDER BY at DESC LIMIT ?`, feedId, limit)
      : this.rows<{ item_json: string }>(`SELECT item_json FROM activity ORDER BY at DESC LIMIT ?`, limit);
    // SAFETY: item_json holds Acquisition values mirrored by ingestRunnerReport.
    return rows.map((row) => JSON.parse(row.item_json) as Acquisition);
  }

  /** Acquisitions that completed within [from, to), newest first; bounded by what the mirror still holds. */
  listActivityBetween(from: string, to: string, limit: number, feedId?: string): ActivityWindow {
    // One row past the limit says whether the limit cut the window short.
    const rows = feedId
      ? this.rows<{ item_json: string }>(`SELECT item_json FROM activity WHERE at >= ? AND at < ? AND feed_id = ? ORDER BY at DESC LIMIT ?`, from, to, feedId, limit + 1)
      : this.rows<{ item_json: string }>(`SELECT item_json FROM activity WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT ?`, from, to, limit + 1);
    const oldest = this.rows<{ at: string | null }>(`SELECT MIN(at) AS at FROM activity`)[0]?.at ?? null;
    // SAFETY: item_json holds Acquisition values mirrored by ingestRunnerReport.
    return { items: rows.slice(0, limit).map((row) => JSON.parse(row.item_json) as Acquisition), oldest, more: rows.length > limit };
  }

  /* ---------- Outages ---------- */

  /** The stretch still running for a feed, or for the platform when the feed ID is empty. */
  openOutage(feedId: string): (Outage & { id: number }) | undefined {
    const row = this.rows<OutageRow>(`SELECT * FROM outages WHERE feed_id = ? AND ended_at IS NULL`, feedId)[0];
    return row ? { id: row.id, ...mapOutage(row) } : undefined;
  }

  startOutage(feedId: string, startedAt: string, cause: OutageCause, failures: number, lastError: string | undefined): void {
    this.exec(
      `INSERT INTO outages (feed_id, started_at, ended_at, cause, failures, last_error) VALUES (?, ?, NULL, ?, ?, ?)`,
      feedId,
      startedAt,
      cause,
      failures,
      lastError ?? null,
    );
  }

  /** Writes only when something changed, so a repeated report costs nothing. */
  updateOutage(id: number, cause: OutageCause, failures: number, lastError: string | undefined): void {
    this.exec(
      `UPDATE outages SET cause = ?, failures = ?, last_error = ? WHERE id = ? AND (cause != ? OR failures != ? OR last_error IS NOT ?)`,
      cause,
      failures,
      lastError ?? null,
      id,
      cause,
      failures,
      lastError ?? null,
    );
  }

  endOutage(id: number, endedAt: string): void {
    this.exec(`UPDATE outages SET ended_at = ? WHERE id = ? AND ended_at IS NULL`, endedAt, id);
  }

  /** A stretch that is only known once it is over: the platform stopped reporting, then came back. */
  recordGap(from: string, to: string): void {
    this.exec(`INSERT INTO outages (feed_id, started_at, ended_at, cause, failures, last_error) VALUES ('', ?, ?, 'platform', 0, NULL)`, from, to);
  }

  /** Every stretch that overlaps [from, to), newest first. */
  outagesBetween(from: string, to: string, limit = 5_000): Outage[] {
    return this.rows<OutageRow>(`SELECT * FROM outages WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at DESC LIMIT ?`, to, from, limit).map(
      mapOutage,
    );
  }

  pruneOutages(before: string): void {
    this.exec(`DELETE FROM outages WHERE ended_at IS NOT NULL AND ended_at < ?`, before);
  }

  /* ---------- Backfill peers ---------- */

  setBackfill(feedId: string, library: string, status: string, updatedAt: string): void {
    this.exec(
      `INSERT INTO backfills (feed_id, library, status, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(feed_id) DO UPDATE SET library = excluded.library, status = excluded.status, updated_at = excluded.updated_at
       WHERE backfills.status != excluded.status OR backfills.updated_at != excluded.updated_at`,
      feedId,
      library,
      status,
      updatedAt,
    );
  }

  countRunningBackfills(library: string, since: string): number {
    return Number(this.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM backfills WHERE library = ? AND status = 'running' AND updated_at >= ?`, library, since)[0]?.n ?? 0);
  }

  /* ---------- Helpers ---------- */

  private exec(query: string, ...bindings: SqlStorageValue[]): void {
    this.sql.exec(query, ...bindings);
  }

  private rows<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.sql.exec<T>(query, ...bindings).toArray();
  }
}

/** One day (or other span) of the activity mirror, and how far back the mirror reaches. */
export interface ActivityWindow {
  items: Acquisition[];
  oldest: string | null;
  /** The window holds more runs than the limit let through. */
  more: boolean;
}

/**
 * Why collection stopped: the source did not answer (`source`), collection failed on our side (`collection`),
 * or the platform itself stopped running collections (`platform`).
 */
export type OutageCause = "source" | "collection" | "platform";

/** A stretch of time in which a feed's live collection kept failing, or the platform collected nothing. */
export interface Outage {
  /** The feed, or null for the platform as a whole. */
  feedId: string | null;
  startedAt: string;
  /** Absent while it is still going on. */
  endedAt?: string;
  cause: OutageCause;
  failures: number;
  lastError?: string;
}

interface OutageRow extends Record<string, SqlStorageValue> {
  id: number;
  feed_id: string;
  started_at: string;
  ended_at: string | null;
  cause: string;
  failures: number;
  last_error: string | null;
}

function mapOutage(row: OutageRow): Outage {
  // SAFETY: cause is written only from the OutageCause union.
  const outage: Outage = { feedId: row.feed_id === "" ? null : row.feed_id, startedAt: row.started_at, cause: row.cause as OutageCause, failures: row.failures };
  if (row.ended_at) outage.endedAt = row.ended_at;
  if (row.last_error) outage.lastError = row.last_error;
  return outage;
}

interface PolicyRow extends Record<string, SqlStorageValue> {
  id: string;
  name: string;
  version: number;
  collection_json: string;
  serving_json: string;
  created_at: string;
}

interface FeedRow extends Record<string, SqlStorageValue> {
  definition_json: string;
  status_json: string | null;
}

function mapPolicy(row: PolicyRow): FeedPolicy {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    // SAFETY: collection_json is written from a validated collection policy.
    collection: JSON.parse(row.collection_json) as CollectionPolicyDefinition,
    // SAFETY: serving_json is written from a validated serving policy.
    serving: JSON.parse(row.serving_json) as ServingPolicyDefinition,
    createdAt: row.created_at,
  };
}

function mapFeed(row: FeedRow): Feed {
  // SAFETY: definition_json is written only from a Feed definition by upsertFeed.
  const definition = JSON.parse(row.definition_json) as Omit<Feed, keyof FeedStatus>;
  // SAFETY: status_json is written only from the FeedStatus a runner reported.
  const status = row.status_json ? (JSON.parse(row.status_json) as FeedStatus) : {};
  return { ...definition, ...status };
}

export type { FeedSemantics, JsonObject, ResolvedFeed, SourceConfig };
