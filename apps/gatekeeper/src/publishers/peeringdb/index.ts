import type { PublisherDefinition } from "#/catalog/define";
import { FEED as portugalExchanges } from "./feeds/portugal-exchanges";

export const PUBLISHER: PublisherDefinition = {
  name: "PeeringDB",
  url: "https://www.peeringdb.com/",
  sources: ["www.peeringdb.com"],
  logo: "png",
  feeds: [portugalExchanges],
};
