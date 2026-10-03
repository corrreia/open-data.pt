import type { PublisherDefinition } from "#/catalog/define";
import { FEED as activeFires } from "./feeds/active-fires";

export const PUBLISHER: PublisherDefinition = {
  name: "EUMETSAT · European Organisation for the Exploitation of Meteorological Satellites",
  url: "https://www.eumetsat.int/",
  logo: "svg",
  sources: [
    // The Data Store's search, files and token endpoint. It answers 429 to too many connections at once.
    { host: "api.eumetsat.int", minIntervalSeconds: 1 },
  ],
  feeds: [activeFires],
};
