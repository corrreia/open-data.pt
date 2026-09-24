import type { PublisherDefinition } from "#/catalog/define";
import { FEED as network } from "./feeds/network";

export const PUBLISHER: PublisherDefinition = {
  name: "Maré",
  sources: ["myinfo.4cloud.pt"],
  logo: "png",
  feeds: [network],
};
