import type { FeedPolicy } from "#/catalog/define";
import { DATAVERSE_MAX_BYTES } from "./dataverse";

export const WEEK = 604_800;

/**
 * ANACOM publishes these indicators once a quarter and rebuilds every file every night, so once a week is plenty: two
 * requests a feed, the index row and the file. Each file is the indicator's whole history since 2018, a couple of
 * thousand values at most, so the first collection already holds all of it and there is nothing to walk back through.
 */
export const STAT_INDICATOR_POLICY: FeedPolicy = {
  cadenceSeconds: WEEK,
  // Every feed's requests to stat.anacom.pt queue behind the host's interval (`minIntervalSeconds` in the publisher's index.ts).
  timeoutSeconds: 120,
  maxBytes: DATAVERSE_MAX_BYTES,
  maxRecords: 20_000,
  historyMode: "changes",
};

/** Two weeks and a day: one missed collection is not yet stale. */
export const STAT_STALE_AFTER_SECONDS = 2 * WEEK + 86_400;
