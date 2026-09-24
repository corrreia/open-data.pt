import type { PublisherDefinition } from "#/catalog/define";
import { FEED as portoAirQuality } from "./feeds/porto-air-quality";
import { FEED as portoNoiseLevels } from "./feeds/porto-noise-levels";

export const PUBLISHER: PublisherDefinition = {
  name: "Porto Digital",
  url: "https://www.portodigital.pt/",
  sources: ["broker.fiware.urbanplatform.portodigital.pt"],
  feeds: [portoAirQuality, portoNoiseLevels],
};
