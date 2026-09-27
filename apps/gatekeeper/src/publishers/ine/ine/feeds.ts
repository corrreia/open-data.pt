const MEBIBYTE = 1024 * 1024;

/**
 * An indicator read without a period filter, so INE returns only its latest
 * period. Collecting it daily keeps every published period in our history,
 * which INE's own endpoint does not return in one call.
 */
export const DAILY_STATISTICS = {
  cadenceSeconds: 86_400,
  timeoutSeconds: 120,
  maxBytes: 8 * MEBIBYTE,
  historyMode: "changes",
} as const;

export const MONTHLY_SERIES = { ...DAILY_STATISTICS, cadenceSeconds: 604_800 } as const;

export const ANNUAL_SERIES = { ...DAILY_STATISTICS, cadenceSeconds: 2_592_000 } as const;
