// A small query cache in the TanStack spirit: one entry per key, shared by every component that asks,
// deduplicated requests, stale data kept on screen while fresh data loads, and a refresh when the tab
// comes back into view.

import { useCallback, useEffect, useSyncExternalStore } from "react";

interface Snapshot<T> {
  data: T | undefined;
  error: Error | undefined;
  updatedAt: number;
  fetching: boolean;
}

class Entry<T> {
  snapshot: Snapshot<T> = { data: undefined, error: undefined, updatedAt: 0, fetching: false };
  readonly listeners = new Set<() => void>();
  private inflight: Promise<void> | undefined;

  constructor(
    public fetcher: () => Promise<T>,
    public staleMs: number,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = () => this.snapshot;

  private publish(next: Snapshot<T>) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  refetch(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.publish({ ...this.snapshot, fetching: true });
    this.inflight = this.fetcher()
      .then((data) => this.publish({ data, error: undefined, updatedAt: Date.now(), fetching: false }))
      .catch((error: Error) => this.publish({ ...this.snapshot, error, fetching: false }))
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  isStale() {
    return this.snapshot.updatedAt === 0 || Date.now() - this.snapshot.updatedAt > this.staleMs;
  }
}

/**
 * Entries are stored type-erased: a key is only ever used with one fetcher contract, so the entry
 * read back under a key holds the T its caller names.
 */
// oxlint-disable-next-line typescript/no-explicit-any
const entries = new Map<string, Entry<any>>();

function entryFor<T>(key: string, fetcher: () => Promise<T>, staleMs: number): Entry<T> {
  const existing: Entry<T> | undefined = entries.get(key);
  if (existing) {
    existing.fetcher = fetcher;
    return existing;
  }
  const entry = new Entry(fetcher, staleMs);
  entries.set(key, entry);
  return entry;
}

export interface QueryOptions {
  /** How long data counts as fresh; a new subscriber refetches after this. */
  staleMs?: number;
  /** Refetch on this interval while mounted. */
  refreshMs?: number;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  fetching: boolean;
  updatedAt: number;
  refetch: () => Promise<void>;
}

const IDLE: Snapshot<never> = { data: undefined, error: undefined, updatedAt: 0, fetching: false };
const noop = () => () => undefined;

/** Read `key` through `fetcher`, cached across the page. A null key waits. */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, options: QueryOptions = {}): QueryResult<T> {
  const staleMs = options.staleMs ?? 15_000;
  const entry = key === null ? null : entryFor(key, fetcher, staleMs);
  const snapshot = useSyncExternalStore(entry?.subscribe ?? noop, entry?.get ?? (() => IDLE));
  useEffect(() => {
    if (entry?.isStale()) void entry.refetch();
    if (!entry || !options.refreshMs) return undefined;
    const timer = setInterval(() => void entry.refetch(), options.refreshMs);
    return () => clearInterval(timer);
  }, [entry, options.refreshMs]);
  const refetch = useCallback(() => entry?.refetch() ?? Promise.resolve(), [entry]);
  return { data: snapshot.data, error: snapshot.error, loading: snapshot.data === undefined && snapshot.error === undefined, fetching: snapshot.fetching, updatedAt: snapshot.updatedAt, refetch };
}

/** Refetch every watched query whose key starts with `prefix`. */
export function invalidate(prefix: string) {
  for (const [key, entry] of entries) {
    if (key.startsWith(prefix) && entry.listeners.size > 0) void entry.refetch();
  }
}

// A tab that was in the background catches up once it is visible again, at most every thirty seconds.
let lastVisible = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden || Date.now() - lastVisible < 30_000) return;
  lastVisible = Date.now();
  for (const entry of entries.values()) if (entry.listeners.size > 0 && entry.isStale()) void entry.refetch();
});
