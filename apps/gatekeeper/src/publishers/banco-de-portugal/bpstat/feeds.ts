import type { FeedDefinition } from "#/index";

const MEBIBYTE = 1024 * 1024;
const WEEK = 604_800;

export const DAILY_STATISTICS = {
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

/** Selected series of a BPstat dataset and their latest observations. The IDs, not domain titles, select the actual Portuguese observations. */
export function selectedSeries(slug: string, domain: string, datasetId: string, seriesIds: number[], lastN: number, cadenceSeconds = WEEK): FeedDefinition {
  return {
    slug,
    config: { source: "bpstat", domain, dataset: datasetId, lang: "EN", seriesIds: seriesIds.join(","), lastN: String(lastN) },
    staleAfterSeconds: cadenceSeconds * 2,
    policy: {
      name: "BPstat selected series and latest observations",
      version: 1,
      collection: {
        cadenceSeconds,
        timeoutSeconds: 120,
        maxBytes: 2 * 1024 * 1024,
        maxOutputBytes: 8 * 1024 * 1024,
        maxRecordBytes: 64 * 1024,
        maxRecords: 10_000,
        historyMode: "changes",
      },
    },
  };
}
