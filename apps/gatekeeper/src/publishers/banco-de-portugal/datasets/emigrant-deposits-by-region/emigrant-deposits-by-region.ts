import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-emigrant-deposits-by-region",
  config: {
    domain: "206",
    dataset: "d5bf6198a39f1e77b0d14dda97103de0",
    lang: "EN",
    seriesIds: "12996746,12996695,12996702,12996706,12996708,12996710,12996715,12996717,12996719",
    lastN: "36",
  },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 36 observations of 9 selected series of BPstat dataset `d5bf6198a39f1e77b0d14dda97103de0`, domain 206. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
