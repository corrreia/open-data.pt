import type { FeedGatekeeper } from "@open-data-pt/contract";
export { default as Gatekeeper } from "../../apps/gatekeeper/src/worker";

interface FixtureEnv {
  GK: Service<FeedGatekeeper>;
}

/** Resolves the first example of every library through the real Worker, over a real service binding. */
export default {
  async fetch(_request: Request, env: FixtureEnv): Promise<Response> {
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
