import type { FeedGatekeeper } from "@open-data-pt/gatekeeper-shared";
export { default as Arcgis } from "../../packages/gatekeeper-arcgis/src/index";
export { default as Bpstat } from "../../packages/gatekeeper-bpstat/src/index";
export { default as Carris } from "../../packages/gatekeeper-carris/src/index";
export { default as Ckan } from "../../packages/gatekeeper-ckan/src/index";
export { default as Dgeg } from "../../packages/gatekeeper-dgeg/src/index";
export { default as Eurostat } from "../../packages/gatekeeper-eurostat/src/index";
export { default as Gbfs } from "../../packages/gatekeeper-gbfs/src/index";
export { default as Gtfs } from "../../packages/gatekeeper-gtfs/src/index";
export { default as Ine } from "../../packages/gatekeeper-ine/src/index";
export { default as Ipma } from "../../packages/gatekeeper-ipma/src/index";
export { default as Metrolisboa } from "../../packages/gatekeeper-metrolisboa/src/index";
export { default as Myinfo } from "../../packages/gatekeeper-myinfo/src/index";
export { default as Ogc } from "../../packages/gatekeeper-ogc/src/index";
export { default as Omie } from "../../packages/gatekeeper-omie/src/index";
export { default as Opendatasoft } from "../../packages/gatekeeper-opendatasoft/src/index";
export { default as Parliament } from "../../packages/gatekeeper-parliament/src/index";
export { default as Ren } from "../../packages/gatekeeper-ren/src/index";
export { default as Udata } from "../../packages/gatekeeper-udata/src/index";

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
