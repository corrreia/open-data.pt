import type { FeedPolicy } from "#/index";

export const MEBIBYTE = 1024 * 1024;
export const WEEK = 604_800;
export const MONTH = 2_592_000;

/**
 * How often, and within what bounds, a feed that reads a bounded window of
 * reporting periods from an Explore v2.1 catalog is collected. Source-side
 * scopes were checked against Explore v2.1 metadata and records in September
 * 2026. `publisherName` is the publisher's name, which the policy is named
 * after.
 */
export function boundedReportingPeriodPolicy(publisherName: string, cadenceSeconds: number): FeedPolicy {
  return {
    name: `${publisherName} bounded reporting-period collection`,
    version: 1,
    collection: {
      cadenceSeconds,
      timeoutSeconds: 180,
      maxBytes: 8 * MEBIBYTE,
      maxOutputBytes: 16 * MEBIBYTE,
      maxRecordBytes: 512 * 1024,
      maxRecords: 20_000,
      historyMode: "changes",
    },
  };
}
