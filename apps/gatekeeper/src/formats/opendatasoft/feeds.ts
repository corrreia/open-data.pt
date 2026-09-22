import type { FeedDefinition, SourceConfig } from "../../index";

export const MEBIBYTE = 1024 * 1024;
export const WEEK = 604_800;
export const MONTH = 2_592_000;

/**
 * A feed that reads a bounded window of reporting periods from an Explore v2.1
 * catalog. Source-side scopes were checked against Explore v2.1 metadata and
 * records in September 2026. `publisherName` is the publisher's name, which the
 * policy is named after.
 */
export function boundedReportingPeriodFeed(slug: string, host: string, publisherName: string, query: SourceConfig, cadenceSeconds: number): FeedDefinition {
  return {
    slug,
    config: { source: "opendatasoft", host, limit: "10000", ...query },
    policy: {
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
    },
    staleAfterSeconds: cadenceSeconds * 2,
  };
}
