import type { ExampleFeed } from "../../index";
import { CATALOG_EXAMPLES } from "./catalog-examples";

const MEBIBYTE = 1024 * 1024;

const DAILY_STATISTICS = {
  name: "BPstat daily dataset snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 180,
    maxBytes: 2 * MEBIBYTE,
    maxOutputBytes: 32 * MEBIBYTE,
    maxRecordBytes: 512 * 1024,
    maxRecords: 100_000,
    historyMode: "changes",
  },
} as const;

export const BPSTAT_EXAMPLES: ExampleFeed[] = [
  {
    slug: "bpstat-consumer-price-index",
    dataset: "banco-de-portugal-consumer-price-index",
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
  {
    slug: "bpstat-employment-and-unemployment",
    dataset: "banco-de-portugal-employment-and-unemployment",
    config: {
      source: "bpstat",
      domain: "13",
      dataset: "b8cc662879c9f7b0f3faf89c7871fc38",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  {
    slug: "bpstat-payment-system-participants",
    dataset: "banco-de-portugal-payment-system-participants",
    config: {
      source: "bpstat",
      domain: "8",
      dataset: "00ac0311f09ecac48b82a9d92f8aa462",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  {
    slug: "bpstat-housing-loan-reference-rates",
    dataset: "banco-de-portugal-housing-loan-reference-rates",
    config: {
      source: "bpstat",
      domain: "186",
      dataset: "63e8780cdb0c94c323528c7237b7a4b8",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  ...CATALOG_EXAMPLES,
];
