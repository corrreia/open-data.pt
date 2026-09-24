import { defineFeed } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-consumer-price-index",
  title: "Consumer price index",
  description: "Monthly consumer price index year-on-year changes for Portugal by consumption aggregate.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: { domain: "12", dataset: "7f13efcd65fc6bd0c5adb0e8d29d9b44", lang: "EN" },
  // About 49,000 points from a 2 MiB source: more than the 32 MiB cap the smaller datasets use.
  policy: {
    ...DAILY_STATISTICS,
    name: "BPstat daily large dataset snapshot",
    collection: { ...DAILY_STATISTICS.collection, maxOutputBytes: 64 * 1024 * 1024 },
  },
  staleAfterSeconds: 604_800,
  /** Once a day: the whole of BPstat dataset `7f13efcd65fc6bd0c5adb0e8d29d9b44`, domain 12. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
