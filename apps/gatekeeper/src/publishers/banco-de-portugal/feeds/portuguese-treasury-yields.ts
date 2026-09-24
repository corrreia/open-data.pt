import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_DAILY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-portuguese-treasury-yields",
  title: "Portuguese Treasury-bond yields",
  description:
    "Daily fixed-rate Portuguese Treasury-bond yields for residual maturities of two, three, four, five, seven and ten years. Latest 366 observations per maturity; excludes monthly repetitions and German/US yields.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "26", dataset: "690b7b36fd36c0dbe249c48cbbc39524", lang: "EN", seriesIds: "12099454,12099455,12099456,12099457,12099458,12099459", lastN: "366" },
  policy: SELECTED_SERIES_DAILY,
  staleAfterSeconds: 172_800,
  /** Once a day: the latest 366 observations of 6 selected series of BPstat dataset `690b7b36fd36c0dbe249c48cbbc39524`, domain 26. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
