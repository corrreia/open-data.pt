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
  serving: {
    licence: "Banco de Portugal information reuse conditions",
    attribution: "Banco de Portugal, BPstat",
  },
} as const;

export const BPSTAT_EXAMPLES: ExampleFeed[] = [
  {
    slug: "bpstat-consumer-price-index",
    title: "Consumer price index",
    description: "Monthly consumer price index year-on-year changes for Portugal by consumption aggregate.",
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
    publisher: "Banco de Portugal",
    topics: ["economy"],
  },
  {
    slug: "bpstat-employment-and-unemployment",
    title: "Population, employment and unemployment indicators",
    description: "Population, unemployment benefit, job application, vacancy, and placement indicators for Portugal.",
    config: {
      source: "bpstat",
      domain: "13",
      dataset: "b8cc662879c9f7b0f3faf89c7871fc38",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "Banco de Portugal",
    topics: ["economy"],
  },
  {
    slug: "bpstat-payment-system-participants",
    title: "Direct debit system participants",
    description: "Monthly and annual counts of active creditors and direct debit authorisations by SEPA scheme.",
    config: {
      source: "bpstat",
      domain: "8",
      dataset: "00ac0311f09ecac48b82a9d92f8aa462",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "Banco de Portugal",
    topics: ["economy"],
  },
  {
    slug: "bpstat-housing-loan-reference-rates",
    title: "Housing loans with other reference rates",
    description: "Monthly shares of new and outstanding permanent-home loans using reference rates outside the named benchmarks.",
    config: {
      source: "bpstat",
      domain: "186",
      dataset: "63e8780cdb0c94c323528c7237b7a4b8",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "Banco de Portugal",
    topics: ["economy"],
  },
  ...CATALOG_EXAMPLES,
];
