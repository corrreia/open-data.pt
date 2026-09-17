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

/**
 * The two Registry calls that lend a history query one of its four slots. Both
 * name the query, so that taking a slot twice with the same name is taking it
 * once: the retry below cannot tell a call that never ran from one whose answer
 * was lost, and the second kind must not cost a second slot.
 */
export interface HistorySlots {
  tryStartHistoryQuery(queryId: string): Promise<boolean>;
  finishHistoryQuery(queryId: string): Promise<void>;
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
 * Work that holds one of the Registry's history slots. The query draws a name
 * for its slot, which makes both calls safe to take again through a fresh stub:
 * a retried request asks for the slot it already holds, and releasing a slot
 * twice releases it once. Releasing can still only cost the slot, because a
 * Registry that cannot be reached afterwards must not discard an answer the
 * lake already gave; the Registry takes such a slot back once the query it
 * named can no longer be running.
 */
export async function withHistorySlot<Answer>(registry: () => HistorySlots, work: () => Promise<Answer>): Promise<Answer> {
  const queryId = crypto.randomUUID();
  if (!(await callRegistry(registry, (coordinator) => coordinator.tryStartHistoryQuery(queryId)))) {
    throw new RequestError("Every history query slot is busy; retry shortly", 429, { "Retry-After": String(HISTORY_BUSY_RETRY_SECONDS) });
  }
  try {
    return await work();
  } finally {
    try {
      await callRegistry(registry, (coordinator) => coordinator.finishHistoryQuery(queryId));
    } catch (error) {
      console.warn(JSON.stringify({ event: "history_slot_not_released", error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
