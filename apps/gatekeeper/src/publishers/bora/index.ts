import type { PublisherDefinition } from "#/catalog/define";
import { FEED as viseuReference } from "./feeds/viseu-reference";
import { FEED as viseu } from "./feeds/viseu";

export const PUBLISHER: PublisherDefinition = {
  name: "Bora",
  sources: ["gbfs.primelayer.pt"],
  logo: "png",
  feeds: [viseuReference, viseu],
};
