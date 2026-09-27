import type { CollectionRequest, FeedGatekeeper } from "@open-data-pt/contract";
export { default as Gatekeeper } from "../../src/worker";

interface FixtureEnv {
  GK: Service<FeedGatekeeper>;
}

/**
 * A request as a kernel of the previous release sends it, for a feed this Gatekeeper does not know: that release named
 * its feed another way, so the protocol has to be answered before any feed is looked up.
 */
function previousRelease(): CollectionRequest {
  return {
    // SAFETY: the previous release's protocol string is exactly what this request must carry through the typed RPC.
    protocol: "open-data-normalized/4" as CollectionRequest["protocol"],
    slug: "no-such-feed",
    configHash: "",
    mode: { kind: "live" },
    limits: { sourceBytes: 1024, outputBytes: 4096, recordBytes: 1024, records: 10 },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    observedAt: new Date().toISOString(),
  };
}

/** What the conformance route answers: two readings of the catalog's digest, and every feed the catalog resolved. */
export interface ConformanceAnswer {
  versions: string[];
  feeds: Array<{ slug: string; library: string; resourceKey: string; configHash: string; eventTimed: boolean }>;
}

/** Reads the catalog through the real Worker, over a real service binding. */
export default {
  async fetch(request: Request, env: FixtureEnv): Promise<Response> {
    if (new URL(request.url).pathname === "/previous-release") return Response.json(await env.GK.collect(previousRelease()));
    const first = await env.GK.catalogVersion();
    const catalog = await env.GK.catalog();
    const second = await env.GK.catalogVersion();
    const answer: ConformanceAnswer = {
      versions: [first, second],
      feeds: catalog.feeds.map(({ slug, library, resourceKey, configHash, eventTimed }) => ({ slug, library, resourceKey, configHash, eventTimed })),
    };
    return Response.json(answer);
  },
};
