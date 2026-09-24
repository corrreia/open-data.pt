import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-goods-trade-growth",
  // The research URL used domain 50 (vehicle registrations and fuel sales). Domain 53 shares
  // this dimension-set hash but actually contains Portuguese international trade observations.
  title: "Growth in Portuguese exports and imports of goods",
  description:
    "Cumulative year-on-year percentage changes in the nominal value of Portuguese goods exports and imports, latest sixty monthly observations. These are cumulative growth rates, not month-on-month changes or vehicle registrations.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "53", dataset: "34e4f2e4ddae13cba3e74c926fc23f48", lang: "EN", seriesIds: "12587117,12587123", lastN: "60" },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 60 observations of 2 selected series of BPstat dataset `34e4f2e4ddae13cba3e74c926fc23f48`, domain 53. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
