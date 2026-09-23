import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_DAILY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-ecb-policy-rates",
  config: { domain: "22", dataset: "471186a839daf97d9280419fc06c8579", lang: "EN", seriesIds: "12504589,12504590,12504591", lastN: "366" },
  policy: SELECTED_SERIES_DAILY,
  staleAfterSeconds: 172_800,
  /** Once a day: the latest 366 observations of 3 selected series of BPstat dataset `471186a839daf97d9280419fc06c8579`, domain 22. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
