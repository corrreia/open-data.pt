import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-banknotes-issued",
  config: { domain: "9", dataset: "002abf63d5a4efb3e35ab5321251d7c5", lang: "EN", seriesIds: "12468838,12468839", lastN: "60" },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 60 observations of 2 selected series of BPstat dataset `002abf63d5a4efb3e35ab5321251d7c5`, domain 9. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
