import { describe, expect, it } from "vitest";
import { feedCollector, type GatekeeperLibraries, type RunnableFeed, type SourceFetch } from "@open-data-pt/gatekeeper";

const BODY: SourceFetch = { kind: "body", body: new Uint8Array(), provenance: { sourceUrl: "https://example.test/" }, completeness: "complete" };

/** A library with nothing to it, so a test feed can run through the Worker's own composition. */
const LIBRARIES: GatekeeperLibraries = new Map([["fixture", { kinds: [], resolve: () => Promise.reject(new Error("not resolved here")), context: {} }]]);

function feed(fetchOf: RunnableFeed["fetch"]): RunnableFeed {
  return {
    slug: "fixture-feed",
    title: "Fixture",
    description: "A feed the test reads",
    licence: "source-terms",
    topics: ["society"],
    config: { source: "fixture" },
    policy: { name: "Fixture", version: 1, collection: { cadenceSeconds: 60, timeoutSeconds: 30, maxBytes: 1024, historyMode: "latest" } },
    staleAfterSeconds: 120,
    fetch: fetchOf,
    transform: {
      normalizer: { id: "fixture", version: "1" },
      buffered: () => ({ transformer: { id: "fixture", version: "1" }, products: [], quality: { acceptedRecords: 0, rejectedRecords: 0 } }),
    },
  };
}

describe("a feed's fetch, as the Worker hands it", () => {
  it("keeps a request's own timeout and the collection's deadline, aborting on whichever ends first", async () => {
    const seen: AbortSignal[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      if (init?.signal) seen.push(init.signal);
      return new Response("");
    };
    const own = new AbortController();
    const collection = new AbortController();
    const collector = feedCollector(
      feed(async ({ fetch }) => {
        await fetch("https://example.test/a", { signal: own.signal });
        await fetch("https://example.test/b");
        return BODY;
      }),
      { source: "fixture" },
      LIBRARIES,
      { fetcher },
    );
    await collector.source(undefined, { kind: "live" }, collection.signal);
    const [withOwn, withoutOwn] = seen;
    expect(withOwn?.aborted).toBe(false);
    own.abort();
    expect(withOwn?.aborted, "the request's own timeout still aborts it").toBe(true);
    expect(withoutOwn?.aborted, "a request without its own signal follows only the collection").toBe(false);
    collection.abort();
    expect(withoutOwn?.aborted, "the collection's deadline aborts every request").toBe(true);
  });

  it("hands a transform the metadata its own fetch described the body with", async () => {
    let received: object | undefined;
    const runnable: RunnableFeed = {
      ...feed(async () => ({ fetch: BODY, metadata: { title: "Described" } })),
      transform: {
        normalizer: { id: "fixture", version: "1" },
        buffered: (_bytes, _context, metadata) => {
          received = metadata;
          return { transformer: { id: "fixture", version: "1" }, products: [], quality: { acceptedRecords: 0, rejectedRecords: 0 } };
        },
      },
    };
    const collector = feedCollector(runnable, { source: "fixture" }, LIBRARIES);
    const fetched = await collector.source(undefined, { kind: "live" }, new AbortController().signal);
    expect(fetched).toBe(BODY);
    if (collector.normalize.kind !== "buffered") throw new Error("expected a buffered transform");
    await collector.normalize.transform(new Uint8Array(), {
      feed: { slug: "fixture-feed", title: "t", description: "d", config: { source: "fixture" }, semantics: { domainSubject: "reference", defaultProductRole: "reference" } },
      observedAt: "2026-09-23T00:00:00.000Z",
    });
    expect(received).toEqual({ title: "Described" });
  });
});
