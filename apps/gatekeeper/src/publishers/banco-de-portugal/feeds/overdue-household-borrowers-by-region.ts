import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-overdue-household-borrowers-by-region",
  title: "Household borrowers with overdue loans by region and purpose",
  description:
    "Percentage of household/NPISH borrowers with overdue housing or consumption/other-purpose loans in each of Portugal's nine NUTS II regions. Latest thirty-six monthly observations; these are borrower shares, not overdue loan balances or loan-value ratios.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: {
    domain: "188",
    dataset: "961306c1ed49daf795a53dc5fea4a04b",
    lang: "EN",
    seriesIds: "12759854,12759855,12759861,12759866,12759871,12759872,12759884,12760149,12760153,12760173,12760174,12760196,12760197,12760199,12760204,12760206,12760515,12760516",
    lastN: "36",
  },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 36 observations of 18 selected series of BPstat dataset `961306c1ed49daf795a53dc5fea4a04b`, domain 188. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
