import type { DatasetDefinition } from "#/catalog/define";
import { OMIE_MAX_BYTES } from "#/publishers/omie/omie/omie";

const POLICY = {
  name: "OMIE day-ahead prices",
  version: 1,
  collection: {
    // OMIE publishes once a day around 13:00 CET; three hours bounds the delay.
    cadenceSeconds: 10_800,
    timeoutSeconds: 30,
    maxBytes: OMIE_MAX_BYTES,
    historyMode: "changes",
  },
} as const;

export const DATASET: DatasetDefinition = {
  title: "OMIE day-ahead prices",
  description: "The Portuguese day-ahead electricity price, hour by hour, as OMIE publishes it and across the coming week.",
  licence: "source-terms",
  attribution: "OMI, Polo Español S.A. (OMIE)",
  topics: ["energy"],
  feeds: [
    // One feed per file family: the seven-day window already holds every day a two-day Spanish feed would.
    {
      slug: "omie-portuguese-day-ahead-prices-feed",
      title: "OMIE Portuguese day-ahead price file",
      description: "The latest two available day-ahead price files from OMIE's Portuguese file family.",
      config: { source: "omie", series: "marginalpdbcpt", days: "2" },
      policy: POLICY,
      staleAfterSeconds: 172_800,
    },
    {
      slug: "omie-seven-day-day-ahead-prices-feed",
      title: "OMIE seven-day day-ahead price window",
      description: "The latest seven available day-ahead price files from OMIE's Spanish file family.",
      config: { source: "omie", series: "marginalpdbc", days: "7" },
      policy: POLICY,
      staleAfterSeconds: 172_800,
    },
  ],
};
