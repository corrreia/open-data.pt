import { RequestError } from "./errors";

/**
 * What the public API asks of the Registry Durable Object, and what keeps those
 * questions answerable. A Durable Object is evicted between calls whenever the
 * platform likes, and the stub that named the old instance then fails with
 * "Connection closed: this Durable Object instance is no longer active". That
 * is not a failed read: the next stub reaches the new instance.
 */

/** Seconds a client should wait when every history query slot is taken. */
export const HISTORY_BUSY_RETRY_SECONDS = 5;

/** The two Registry calls that lend a history query one of its four slots. */
export interface HistorySlots {
  tryStartHistoryQuery(): Promise<boolean>;
  finishHistoryQuery(): Promise<void>;
}

/** A Durable Object evicted between calls: the stub is stale, and a fresh one reaches the new instance. */
function isStaleStub(error: Error): boolean {
  return /no longer active|Connection closed/i.test(error.message);
}

/** One call, taken again with a fresh stub when the instance behind the old one was evicted. */
export async function callRegistry<Stub, Answer>(stub: () => Stub, call: (target: Stub) => Promise<Answer>): Promise<Answer> {
  try {
    return await call(stub());
  } catch (error) {
    if (!(error instanceof Error) || !isStaleStub(error)) throw error;
    return await call(stub());
  }
}

/**
 * Work that holds one of the Registry's history slots. Taking the slot is
 * retried through a fresh stub; releasing it can only ever cost the slot,
 * because a Registry that cannot be reached afterwards must not discard an
 * answer the lake already gave, and an evicted one counts nothing to release.
 */
export async function withHistorySlot<Answer>(registry: () => HistorySlots, work: () => Promise<Answer>): Promise<Answer> {
  if (!(await callRegistry(registry, (coordinator) => coordinator.tryStartHistoryQuery()))) {
    throw new RequestError("Every history query slot is busy; retry shortly", 429, { "Retry-After": String(HISTORY_BUSY_RETRY_SECONDS) });
  }
  try {
    return await work();
  } finally {
    try {
      await callRegistry(registry, (coordinator) => coordinator.finishHistoryQuery());
    } catch (error) {
      console.warn(JSON.stringify({ event: "history_slot_not_released", error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
