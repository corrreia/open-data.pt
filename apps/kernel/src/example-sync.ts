import type { ExampleFeed, FeedKindDescription } from "@open-data-pt/gatekeeper-shared";

import { digest } from "./hash";

/**
 * Keeping the Registry's feeds in step with the Gatekeeper, with no operator:
 * every example it lists is a feed. The Registry alarm runs one step
 * at a time; this module is the decision logic, free of Durable Object APIs.
 */

/** How often the Gatekeeper's examples and feed kinds are compared with the feeds. */
export const SYNC_CHECK_MS = 15 * 60_000;
/** How often every feed is resolved and handed to its runner again, even when nothing it came from changed. */
export const SYNC_RESOLVE_ALL_MS = 24 * 60 * 60_000;
/**
 * Feed installs, updates and retirements per step. Each one is a runner round
 * trip that reports back to the Registry; 29 in one request once hit the Workers
 * "subrequest depth limit exceeded" error after eight.
 */
export const SYNC_BATCH = 4;

/** One library's part of the Gatekeeper's answer: its examples and the feed kinds it resolves them with. */
export interface CatalogEntry {
  /** The library's name, which is the `source` key its examples carry and the feeds' `gatekeeperKind`. */
  kind: string;
  examples: ExampleFeed[];
  kinds: FeedKindDescription[];
}

/** The part of a stored feed the sync needs. */
export interface SyncFeed {
  id: string;
  slug: string;
}

/** Install or update one example, or retire a feed whose example is gone. */
export type SyncOp = { op: "apply"; kind: string; example: ExampleFeed; hash: string } | { op: "retire"; feedId: string; slug: string };

export interface SyncState {
  nextCheckAt: number;
  nextResolveAllAt: number;
  queue: SyncOp[];
  /** Per example slug, the hash of the example and its Gatekeeper's feed kinds last applied successfully. */
  hashes: Record<string, string>;
  lastCheckedAt?: string;
  lastError?: string;
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
  /** The Gatekeeper's examples and kinds, by library; `undefined` when it did not answer, or answered with nothing. */
  readCatalog(): Promise<CatalogEntry[] | undefined>;
  feeds(): SyncFeed[];
  apply(kind: string, example: ExampleFeed): Promise<void>;
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
  const state = ports.load() ?? { nextCheckAt: 0, nextResolveAllAt: 0, queue: [], hashes: {} };
  const progress: SyncProgress = { checked: false, applied: 0, retired: 0, failed: 0, pending: 0 };
  if (state.queue.length === 0 && (options.check === true || now >= state.nextCheckAt)) {
    const catalog = await ports.readCatalog();
    state.nextCheckAt = now + SYNC_CHECK_MS;
    if (catalog === undefined) {
      state.lastError = "The Gatekeeper did not answer; its feeds are kept as they are";
      ports.save(state);
      return progress;
    }
    const resolveAll = now >= state.nextResolveAllAt;
    state.queue = planSync(catalog, ports.feeds(), state.hashes, resolveAll);
    if (resolveAll) state.nextResolveAllAt = now + SYNC_RESOLVE_ALL_MS;
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
        await ports.apply(op.kind, op.example);
        state.hashes[op.example.slug] = op.hash;
        progress.applied += 1;
      } else {
        await ports.retire(op.feedId);
        delete state.hashes[op.slug];
        progress.retired += 1;
      }
    } catch (error) {
      progress.failed += 1;
      const subject = op.op === "apply" ? op.example.slug : op.slug;
      state.lastError = `${subject}: ${String(error)}`.slice(0, 500);
      console.warn(JSON.stringify({ event: "example_sync_operation_failed", op: op.op, subject, error: String(error) }));
    }
  }
  progress.pending = state.queue.length;
  ports.save(state);
  return progress;
}

/**
 * What one check queues: new and changed examples (every example on a
 * re-resolve day), then feeds whose example is gone. A library the Gatekeeper
 * no longer carries (held, or deleted) lists nothing, so its feeds go.
 */
export function planSync(catalog: CatalogEntry[], feeds: SyncFeed[], hashes: Record<string, string>, resolveAll: boolean): SyncOp[] {
  const ops: SyncOp[] = [];
  const installed = new Set(feeds.map((feed) => feed.slug));
  const listed = new Set<string>();
  for (const entry of catalog) {
    const kindsHash = digest(JSON.stringify(entry.kinds));
    for (const example of entry.examples) {
      listed.add(example.slug);
      const hash = digest(`${kindsHash}|${JSON.stringify(example)}`);
      if (resolveAll || !installed.has(example.slug) || hashes[example.slug] !== hash) ops.push({ op: "apply", kind: entry.kind, example, hash });
    }
  }
  for (const feed of feeds) if (!listed.has(feed.slug)) ops.push({ op: "retire", feedId: feed.id, slug: feed.slug });
  return ops;
}
