import type { FeedGatekeeper } from "@open-data-pt/gatekeeper-shared";
export { default as Cities } from "../../packages/gatekeeper-cities/src/index";
export { default as Energy } from "../../packages/gatekeeper-energy/src/index";
export { default as Environment } from "../../packages/gatekeeper-environment/src/index";
export { default as Health } from "../../packages/gatekeeper-health/src/index";
export { default as Mobility } from "../../packages/gatekeeper-mobility/src/index";
export { default as Statistics } from "../../packages/gatekeeper-statistics/src/index";

interface FixtureEnv {
  [key: `GK_${string}`]: Service<FeedGatekeeper>;
}

export default {
  async fetch(_request: Request, env: FixtureEnv): Promise<Response> {
    const output = [];
    for (const [binding, gatekeeper] of Object.entries(env).filter(([name]) => name.startsWith("GK_"))) {
      const [description, kinds, examples] = await Promise.all([gatekeeper.describe(), gatekeeper.listFeedKinds(), gatekeeper.exampleFeeds()]);
      const example = examples[0];
      if (!example) throw new Error(`${binding} has no conformance example`);
      try {
        const resolved = await gatekeeper.resolveFeed(example.config);
        output.push({ binding, description, kindCount: kinds.length, resolved });
      } catch (error) {
        throw new Error(`${binding}: ${String(error)}`);
      }
    }
    return Response.json(output.sort((left, right) => left.binding.localeCompare(right.binding)));
  },
};
