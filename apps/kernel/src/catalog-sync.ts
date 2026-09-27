import type { CatalogFeed } from "@open-data-pt/contract";

import { digest } from "./hash";

/**
 * Keeping the Registry's feeds in step with the Gatekeeper, with no operator:
 * every feed its catalog lists is installed, as the catalog resolves it. The
 * Registry alarm runs one step at a time; this module is the decision logic,
 * free of Durable Object APIs.
 */

/** How often the Gatekeeper's catalog is compared with the feeds. */
export const SYNC_CHECK_MS = 15 * 60_000;
/**
 * The least time between two checks brought forward by a catalog version the
 * last check did not see: while a release rolls out, runners hear the new
 * Gatekeeper before every instance of it answers the Registry.
 */
export const VERSION_CHECK_MIN_MS = 60_000;
/**
 * Feed installs, updates and retirements per step. Each one is a runner round
 * trip that reports back to the Registry; 29 in one request once hit the Workers
 * "subrequest depth limit exceeded" error after eight.
 */
export const SYNC_BATCH = 4;

/** The part of a stored feed the sync needs. */
export interface SyncFeed {
  id: string;
  slug: string;
}

/**
 * A local session's floor under a feed's cadence: a laptop reads a public source once and leaves it
 * alone, instead of polling positions every minute all evening. The freshness window moves with it,
 * so a feed slowed to half an hour is not shown as late thirty seconds after it ran. A deployment
 * sets no floor and every policy's own cadence stands.
 */
export function withCadenceFloor(feed: CatalogFeed, floorSeconds: number): CatalogFeed {
  if (floorSeconds <= 0 || feed.policy.cadenceSeconds >= floorSeconds) return feed;
  return { ...feed, policy: { ...feed.policy, cadenceSeconds: floorSeconds }, staleAfterSeconds: Math.max(feed.staleAfterSeconds, floorSeconds * 3) };
}

/** The floor a `DEV_MIN_CADENCE_SECONDS` var asks for: a positive whole number of seconds, or none. */
export function cadenceFloorOf(value: string | undefined): number {
  const seconds = Number(value ?? "");
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
}

/** Install or update one feed the catalog lists, or retire one it no longer does. */
export type SyncOp = { op: "apply"; feed: CatalogFeed; hash: string } | { op: "retire"; feedId: string; slug: string };

export interface SyncState {
  nextCheckAt: number;
  queue: SyncOp[];
  /** Per feed slug, the hash of the catalog entry last applied successfully. */
  hashes: Record<string, string>;
  lastCheckedAt?: string;
  lastError?: string;
  /** The Gatekeeper's catalog version the last check read with its catalog; absent from one that does not say. */
  catalogVersion?: string;
  /** When a newer catalog version last brought a check forward. */
  versionCheckAt?: number;
}

export interface SyncProgress {
  checked: boolean;
  applied: number;
  retired: number;
  failed: number;
  /** Operations still queued; the alarm runs another step right away while this is above zero. */
  pending: number;
}

export interface SyncPorts {
  /** The feeds the Gatekeeper's catalog lists; `undefined` when it did not answer, or answered with nothing. */
  readCatalog(): Promise<CatalogFeed[] | undefined>;
  /** The Gatekeeper's catalog version; `undefined` from one too old to say. */
  catalogVersion(): Promise<string | undefined>;
  feeds(): SyncFeed[];
  apply(feed: CatalogFeed): Promise<void>;
  retire(feedId: string): Promise<void>;
  load(): SyncState | undefined;
  save(state: SyncState): void;
  now(): number;
}

/**
 * One step: when the queue is empty and a check is due (or asked for), read
 * the catalog and queue what changed; then run at most SYNC_BATCH operations.
 * A failed operation keeps its old hash, so the next check queues it again.
 * A Gatekeeper that did not answer is broken rather than emptied: nothing is
 * retired, and the next check asks again.
 */
export async function syncStep(ports: SyncPorts, options: { check?: boolean } = {}): Promise<SyncProgress> {
  const now = ports.now();
  const state = ports.load() ?? { nextCheckAt: 0, queue: [], hashes: {} };
  const progress: SyncProgress = { checked: false, applied: 0, retired: 0, failed: 0, pending: 0 };
  if (state.queue.length === 0 && (options.check === true || now >= state.nextCheckAt)) {
    const [catalog, version] = await Promise.all([ports.readCatalog(), ports.catalogVersion()]);
    state.nextCheckAt = now + SYNC_CHECK_MS;
    if (catalog === undefined) {
      state.lastError = "The Gatekeeper did not answer; its feeds are kept as they are";
      ports.save(state);
      return progress;
    }
    if (version === undefined) delete state.catalogVersion;
    else state.catalogVersion = version;
    state.queue = planSync(catalog, ports.feeds(), state.hashes);
    state.lastCheckedAt = new Date(now).toISOString();
    // A check that finds nothing left to do ends the last failure's story; a failed operation is queued again by the
    // check, so its error is set again if it fails again.
    if (state.queue.length === 0) delete state.lastError;
    progress.checked = true;
    ports.save(state);
  }
  for (const op of state.queue.splice(0, SYNC_BATCH)) {
    try {
      if (op.op === "apply") {
        await ports.apply(op.feed);
        state.hashes[op.feed.slug] = op.hash;
        progress.applied += 1;
      } else {
        await ports.retire(op.feedId);
        delete state.hashes[op.slug];
        progress.retired += 1;
      }
    } catch (error) {
      progress.failed += 1;
      const subject = op.op === "apply" ? op.feed.slug : op.slug;
      state.lastError = `${subject}: ${String(error)}`.slice(0, 500);
      console.warn(JSON.stringify({ event: "catalog_sync_operation_failed", op: op.op, subject, error: String(error) }));
    }
  }
  progress.pending = state.queue.length;
  ports.save(state);
  return progress;
}

/**
 * What one check queues: new and changed feeds, then feeds the catalog no longer
 * lists. A library the Gatekeeper no longer carries (held, or deleted) lists
 * nothing, so its feeds go.
 */
export function planSync(catalog: CatalogFeed[], feeds: SyncFeed[], hashes: Record<string, string>): SyncOp[] {
  const ops: SyncOp[] = [];
  const installed = new Set(feeds.map((feed) => feed.slug));
  const listed = new Set<string>();
  for (const feed of catalog) {
    listed.add(feed.slug);
    const hash = digest(JSON.stringify(feed));
    if (!installed.has(feed.slug) || hashes[feed.slug] !== hash) ops.push({ op: "apply", feed, hash });
  }
  for (const feed of feeds) if (!listed.has(feed.slug)) ops.push({ op: "retire", feedId: feed.id, slug: feed.slug });
  return ops;
}

/**
 * The sync state with its next check brought forward to now, when a runner
 * heard a catalog version the last check did not read: a Gatekeeper release
 * reaches the feeds within a minute of answering, not at the next scheduled
 * check. `undefined` when nothing should change: no version heard, the one
 * already read, a check already due or under way, or one brought forward
 * within the last minute.
 */
export function checkForVersion(state: SyncState | undefined, version: string | undefined, now: number): SyncState | undefined {
  if (!state || version === undefined || state.catalogVersion === version) return undefined;
  if (state.queue.length > 0 || state.nextCheckAt <= now) return undefined;
  if (state.versionCheckAt !== undefined && now - state.versionCheckAt < VERSION_CHECK_MIN_MS) return undefined;
  return { ...state, nextCheckAt: now, versionCheckAt: now };
}
