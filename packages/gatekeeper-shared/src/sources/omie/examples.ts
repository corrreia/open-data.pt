import type { ExampleFeed } from "../../index";
import { OMIE_MAX_BYTES } from "./omie";

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
  serving: {
    licence: "Source terms apply",
    attribution: "OMI, Polo Español S.A. (OMIE)",
  },
} as const;

// One feed per file family: the seven-day window already holds every day a two-day Spanish feed would.
export const OMIE_EXAMPLES: ExampleFeed[] = [
  {
    slug: "omie-portuguese-day-ahead-prices-feed",
    title: "OMIE Portuguese day-ahead price file",
    description: "The latest two available day-ahead price files from OMIE's Portuguese file family.",
    config: { source: "omie", series: "marginalpdbcpt", days: "2" },
    policy: POLICY,
    staleAfterSeconds: 172_800,
    publisher: "OMIE · Iberian electricity market",
    topics: ["energy"],
  },
  {
    slug: "omie-seven-day-day-ahead-prices-feed",
    title: "OMIE seven-day day-ahead price window",
    description: "The latest seven available day-ahead price files from OMIE's Spanish file family.",
    config: { source: "omie", series: "marginalpdbc", days: "7" },
    policy: POLICY,
    staleAfterSeconds: 172_800,
    publisher: "OMIE · Iberian electricity market",
    topics: ["energy"],
  },
];
