import { describe, expect, it } from "vitest";
import { feedCollector, feedNormalizer, type GatekeeperLibraries, type ProductBuild, type RunnableFeed, type SourceFetch, type TransformContext } from "@open-data-pt/gatekeeper";

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

  describe("what a feed's products are called", () => {
    const CONTEXT: TransformContext = {
      feed: {
        slug: "fixture-feed",
        title: "Cascais beaches",
        description: "Beaches in Cascais with their location and facilities.",
        config: { source: "fixture" },
        semantics: { domainSubject: "reference", defaultProductRole: "reference" },
      },
      observedAt: "2026-09-24T00:00:00.000Z",
    };
    const product = (productKey: string, title: string): ProductBuild => ({
      productKey,
      slug: productKey,
      title,
      description: "Dados geográficos em formato GeoJSON (WGS84)",
      role: "reference",
      kind: "record",
      schema: { fields: [] },
      updateMode: "authoritative-snapshot",
      completeness: "complete",
      records: [],
    });
    const collected = (products: ProductBuild[]) => {
      const runnable: RunnableFeed = {
        ...feed(async () => BODY),
        transform: {
          normalizer: { id: "fixture", version: "1" },
          buffered: () => ({ transformer: { id: "fixture", version: "1" }, products, quality: { acceptedRecords: 0, rejectedRecords: 0 } }),
        },
      };
      return feedCollector(runnable, { source: "fixture" }, LIBRARIES);
    };

    it("names a feed's only product as the feed is named, not as the source names its file", async () => {
      const collector = collected([product("records", "Praia")]);
      if (collector.normalize.kind !== "buffered") throw new Error("expected a buffered transform");
      const result = await collector.normalize.transform(new Uint8Array(), CONTEXT);
      expect(result.products.map(({ title, description }) => ({ title, description }))).toEqual([
        { title: "Cascais beaches", description: "Beaches in Cascais with their location and facilities." },
      ]);
    });

    it("leaves each of several products its own name, which is what tells them apart", async () => {
      const collector = collected([product("stations", "Station prices"), product("medians", "Median price by municipality")]);
      if (collector.normalize.kind !== "buffered") throw new Error("expected a buffered transform");
      const result = await collector.normalize.transform(new Uint8Array(), CONTEXT);
      expect(result.products.map((each) => each.title)).toEqual(["Station prices", "Median price by municipality"]);
    });

    it("runs under a normalizer marked for it, so a checkpoint from before is not this collection's", () => {
      const collector = collected([]);
      expect(collector.normalizer).toEqual(feedNormalizer({ id: "fixture", version: "1" }));
      expect(collector.normalizer.version).not.toBe("1");
    });
  });
});
