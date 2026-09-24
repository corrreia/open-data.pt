import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-new-car-loan-amount-percentiles",
  title: "New car-loan contract amount percentiles",
  description:
    "25th, 50th and 75th percentiles of new car-loan amounts, separately for new vehicles, used vehicles and all car loans in Portugal. Values are euros, not contract counts or APRs; latest thirty-six monthly observations.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: {
    domain: "209",
    dataset: "023d7ab3054d8a0d2db8de50c0ca394b",
    lang: "EN",
    seriesIds: "13168888,13168889,13168890,13168893,13168894,13168895,13168898,13168899,13168900",
    lastN: "36",
  },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 36 observations of 9 selected series of BPstat dataset `023d7ab3054d8a0d2db8de50c0ca394b`, domain 209. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
