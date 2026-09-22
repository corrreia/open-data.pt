import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/banco-de-portugal/bpstat/feeds";

const MEBIBYTE = 1024 * 1024;

export const DATASET: DatasetDefinition = {
  title: "Consumer price index",
  description: "Monthly consumer price index year-on-year changes for Portugal by consumption aggregate.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    {
      slug: "bpstat-consumer-price-index",
      config: {
        source: "bpstat",
        domain: "12",
        dataset: "7f13efcd65fc6bd0c5adb0e8d29d9b44",
        lang: "EN",
      },
      // About 49,000 points from a 2 MiB source: more than the 32 MiB cap the smaller datasets use.
      policy: {
        ...DAILY_STATISTICS,
        name: "BPstat daily large dataset snapshot",
        collection: { ...DAILY_STATISTICS.collection, maxOutputBytes: 64 * MEBIBYTE },
      },
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
