import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-household-indebtedness",
  title: "Household indebtedness and loan growth",
  description:
    "Portuguese household indebtedness and housing/consumer-loan amounts in millions of euros, plus source annual rates of change for housing and consumption/other-purpose loans. Latest sixty monthly observations; this particular dataset does not contain business indebtedness.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "18", dataset: "56ebacd8518e60ef58c85cb8185b4818", lang: "EN", seriesIds: "12457868,12457869,12457924,12458130,12458133", lastN: "60" },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 60 observations of 5 selected series of BPstat dataset `56ebacd8518e60ef58c85cb8185b4818`, domain 18. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
