import { defineFeed } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-employment-and-unemployment",
  title: "Population, employment and unemployment indicators",
  description: "Population, unemployment benefit, job application, vacancy, and placement indicators for Portugal.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "13", dataset: "b8cc662879c9f7b0f3faf89c7871fc38", lang: "EN" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 604_800,
  /** Once a day: the whole of BPstat dataset `b8cc662879c9f7b0f3faf89c7871fc38`, domain 13. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
