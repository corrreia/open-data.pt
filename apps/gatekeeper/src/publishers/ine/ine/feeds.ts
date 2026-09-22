import type { FeedDefinition } from "../../../catalog/define";

const MEBIBYTE = 1024 * 1024;

export const DAILY_STATISTICS = {
  name: "INE daily indicator snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 120,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

export const MONTHLY_SERIES = {
  ...DAILY_STATISTICS,
  name: "INE monthly indicator series",
  collection: {
    ...DAILY_STATISTICS.collection,
    cadenceSeconds: 604_800,
  },
} as const;

export const ANNUAL_SERIES = {
  ...DAILY_STATISTICS,
  name: "INE annual indicator series",
  collection: {
    ...DAILY_STATISTICS.collection,
    cadenceSeconds: 2_592_000,
  },
} as const;

/** An annual indicator read without a period filter: one indicator is one dataset and this feed is the whole of it. */
export function annualLatest(slug: string, indicator: string, policy: FeedDefinition["policy"] = ANNUAL_SERIES): FeedDefinition {
  return {
    slug,
    config: { source: "ine", indicator, lang: "PT" },
    policy,
    staleAfterSeconds: 5_184_000,
  };
}

/**
 * An indicator read without a period filter, so INE returns only its latest
 * period. Collecting it daily keeps every published period in our history,
 * which INE's own endpoint does not return in one call.
 */
export function latestPeriod(slug: string, indicator: string): FeedDefinition {
  return {
    slug,
    config: { source: "ine", indicator, lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  };
}
