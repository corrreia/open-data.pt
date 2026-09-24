import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_WEEKLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-government-deposit-assets",
  title: "Regional, local government and social-security deposits",
  description:
    "Monthly deposit assets held by regional government, local government and social-security funds in Portugal, in millions of euros. Latest sixty observations; these are deposit assets, not public-debt liabilities.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "28", dataset: "10470e6b60c710218dd2a0e6a20fb040", lang: "EN", seriesIds: "13168814,13168815,13168816", lastN: "60" },
  policy: SELECTED_SERIES_WEEKLY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 60 observations of 3 selected series of BPstat dataset `10470e6b60c710218dd2a0e6a20fb040`, domain 28. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
