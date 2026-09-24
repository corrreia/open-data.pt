import type { PublisherDefinition } from "#/catalog/define";
import { FEED as forosSalvaterraMarinhais } from "./feeds/foros-salvaterra-marinhais";
import { FEED as network } from "./feeds/network";

export const PUBLISHER: PublisherDefinition = {
  name: "Ribatejana",
  sources: ["myinfo.4cloud.pt"],
  logo: "png",
  feeds: [forosSalvaterraMarinhais, network],
};
