import { defineFeed } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-housing-loan-reference-rates",
  title: "Housing loans with other reference rates",
  description: "Monthly shares of new and outstanding permanent-home loans using reference rates outside the named benchmarks.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "186", dataset: "63e8780cdb0c94c323528c7237b7a4b8", lang: "EN" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 604_800,
  /** Once a day: the whole of BPstat dataset `63e8780cdb0c94c323528c7237b7a4b8`, domain 186. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
