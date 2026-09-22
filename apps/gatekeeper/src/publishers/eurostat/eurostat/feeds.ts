import type { FeedDefinition } from "../../../catalog/define";
import { EUROSTAT_MAX_BYTES } from "./eurostat";

export const DAY = 86_400;

export const DAILY_STATISTICS = {
  name: "Eurostat daily dataset snapshot",
  version: 1,
  collection: {
    cadenceSeconds: DAY,
    timeoutSeconds: 30,
    maxBytes: EUROSTAT_MAX_BYTES,
    historyMode: "changes",
  },
} as const;

/**
 * A single monthly Portugal series, keeping the last ten years. Each series is a
 * dataset of its own and this feed is the whole of it.
 */
export function portugalMonthly(slug: string, portalDataset: string, filters: string, unit?: string): FeedDefinition {
  // Datasets without a unit dimension state their unit here, as documented by Eurostat.
  const config: FeedDefinition["config"] = { source: "eurostat", dataset: portalDataset, filters, lastTimePeriod: "120", lang: "EN" };
  if (unit) config.unit = unit;
  return {
    slug,
    config,
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  };
}
