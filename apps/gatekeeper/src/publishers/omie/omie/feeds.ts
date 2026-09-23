import { OMIE_MAX_BYTES } from "./omie";

/** The policy both of OMIE's day-ahead price feeds share. */
export const OMIE_DAY_AHEAD_POLICY = {
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
