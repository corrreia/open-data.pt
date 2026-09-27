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

/** Resolves the first example of every library through the real Worker, over a real service binding. */
export default {
  async fetch(request: Request, env: FixtureEnv): Promise<Response> {
    if (new URL(request.url).pathname === "/previous-release") return Response.json(await env.GK.collect(previousRelease()));
    const [description, kinds, examples] = await Promise.all([env.GK.describe(), env.GK.listFeedKinds(), env.GK.exampleFeeds()]);
    const output = [];
    const seen = new Set<string>();
    for (const example of examples) {
      const library = example.config.source ?? "";
      if (seen.has(library)) continue;
      seen.add(library);
      try {
        const resolved = await env.GK.resolveFeed(example.config);
        output.push({ library, description, kindCount: kinds.filter((kind) => kind.kind.startsWith(`${library}:`)).length, resolved });
      } catch (error) {
        throw new Error(`${library}: ${String(error)}`);
      }
    }
    return Response.json(output.sort((left, right) => left.library.localeCompare(right.library)));
  },
};
