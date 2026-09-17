import { describe, expect, it } from "vitest";
import { RequestError } from "../apps/kernel/src/errors";
import { callRegistry, withHistorySlot, type HistorySlots } from "../apps/kernel/src/registry-calls";

const EVICTED = "Connection closed: this Durable Object instance is no longer active.";

/** A Registry whose first calls fail the way an evicted Durable Object does, and that counts what it was asked. */
class EvictedRegistry implements HistorySlots {
  starts = 0;
  finishes = 0;
  constructor(
    private readonly failedStarts = 0,
    private readonly failedFinishes = 0,
    private readonly busy = false,
  ) {}
  async tryStartHistoryQuery(_queryId: string): Promise<boolean> {
    this.starts += 1;
    if (this.starts <= this.failedStarts) throw new Error(EVICTED);
    return !this.busy;
  }
  async finishHistoryQuery(_queryId: string): Promise<void> {
    this.finishes += 1;
    if (this.finishes <= this.failedFinishes) throw new Error(EVICTED);
  }
}

/**
 * A Registry that survives the call but loses the reply, holding its slots the
 * way the real one does: by the name the query gave, not by a count.
 */
class LiveRegistry implements HistorySlots {
  readonly held = new Set<string>();
  private replies = 0;
  constructor(private readonly lostReplies = 0) {}
  async tryStartHistoryQuery(queryId: string): Promise<boolean> {
    if (!this.held.has(queryId)) {
      if (this.held.size >= 4) return false;
      this.held.add(queryId);
    }
    this.replies += 1;
    if (this.replies <= this.lostReplies) throw new Error(EVICTED);
    return true;
  }
  async finishHistoryQuery(queryId: string): Promise<void> {
    this.held.delete(queryId);
  }
}

describe("a Registry evicted between calls does not fail a public read", () => {
  it("takes the history slot again through a fresh stub", async () => {
    const target = new EvictedRegistry(1);
    let stubs = 0;
    const answer = await withHistorySlot(
      () => {
        stubs += 1;
        return target;
      },
      async () => "rows",
    );
    expect(answer).toBe("rows");
    expect(target.starts).toBe(2);
    // The retry asks for a new stub: the old one names an instance that is gone.
    expect(stubs).toBeGreaterThan(1);
  });

  it("strands no slot when the Registry ran the call and only the reply was lost", async () => {
    // The instance is alive and took the slot; the answer never arrived. Taking
    // it again must ask for the same slot, not a second one.
    const target = new LiveRegistry(1);
    expect(
      await withHistorySlot(
        () => target,
        async () => "rows",
      ),
    ).toBe("rows");
    expect(target.held.size).toBe(0);
  });

  it("keeps an answer the lake already gave when the slot cannot be released", async () => {
    // Both the release and its retry fail: an eleven-second query must not be thrown away over a counter.
    const target = new EvictedRegistry(0, 2);
    expect(
      await withHistorySlot(
        () => target,
        async () => "rows",
      ),
    ).toBe("rows");
    expect(target.finishes).toBe(2);
  });

  it("releases the slot after a failed query, and reports the query's own failure", async () => {
    const target = new EvictedRegistry();
    await expect(
      withHistorySlot(
        () => target,
        async () => {
          throw new Error("R2 SQL could not be reached");
        },
      ),
    ).rejects.toThrow(/R2 SQL/);
    expect(target.finishes).toBe(1);
  });

  it("asks the client to retry when every slot is busy, without running the query", async () => {
    const target = new EvictedRegistry(0, 0, true);
    let ran = false;
    await expect(
      withHistorySlot(
        () => target,
        async () => {
          ran = true;
          return "rows";
        },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(ran).toBe(false);
    expect(target.finishes).toBe(0);
  });

  it("retries nothing else: a Registry that answers with a real failure fails the request", async () => {
    let calls = 0;
    await expect(
      callRegistry(
        () => calls,
        async () => {
          calls += 1;
          throw new RequestError("feed was not found", 404);
        },
      ),
    ).rejects.toThrow(/was not found/);
    expect(calls).toBe(1);
  });
});
