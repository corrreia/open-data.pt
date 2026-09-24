import type { PublisherDefinition } from "#/catalog/define";
import { FEED as digiPtAs20879InternetSignals } from "./feeds/digi-pt-as20879-internet-signals";
import { FEED as meoAs3243InternetSignals } from "./feeds/meo-as3243-internet-signals";
import { FEED as nosAs2860InternetSignals } from "./feeds/nos-as2860-internet-signals";
import { FEED as nosMadeiraAs15457InternetSignals } from "./feeds/nos-madeira-as15457-internet-signals";
import { FEED as portugalInternetOutageAlerts } from "./feeds/portugal-internet-outage-alerts";
import { FEED as portugalInternetOutages } from "./feeds/portugal-internet-outages";
import { FEED as portugalInternetSignals } from "./feeds/portugal-internet-signals";
import { FEED as vodafoneAs12353InternetSignals } from "./feeds/vodafone-as12353-internet-signals";

export const PUBLISHER: PublisherDefinition = {
  name: "IODA · Internet Intelligence Lab, Georgia Tech",
  url: "https://ioda.inetintel.cc.gatech.edu/",
  sources: ["api.ioda.inetintel.cc.gatech.edu"],
  logo: "png",
  // Held: Georgia Tech states no terms for IODA — every response reserves rights rather than granting them — and
  // signals it blends (Merit's telescope, Google's Transparency Report, RIPE RIS) carry their own bars on
  // redistribution. Waiting on ioda-info@cc.gatech.edu. https://api.ioda.inetintel.cc.gatech.edu/v2/datasources/
  enabled: false,
  feeds: [
    digiPtAs20879InternetSignals,
    meoAs3243InternetSignals,
    nosAs2860InternetSignals,
    nosMadeiraAs15457InternetSignals,
    portugalInternetOutageAlerts,
    portugalInternetOutages,
    portugalInternetSignals,
    vodafoneAs12353InternetSignals,
  ],
};
