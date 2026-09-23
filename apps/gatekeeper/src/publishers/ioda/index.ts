import type { PublisherDefinition } from "#/catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "IODA · Internet Intelligence Lab, Georgia Tech",
  url: "https://ioda.inetintel.cc.gatech.edu/",
  sources: ["api.ioda.inetintel.cc.gatech.edu"],
  logo: "png",
  // Held: Georgia Tech states no terms for IODA — every response reserves rights rather than granting them — and
  // signals it blends (Merit's telescope, Google's Transparency Report, RIPE RIS) carry their own bars on
  // redistribution. Waiting on ioda-info@cc.gatech.edu. https://api.ioda.inetintel.cc.gatech.edu/v2/datasources/
  enabled: false,
};
