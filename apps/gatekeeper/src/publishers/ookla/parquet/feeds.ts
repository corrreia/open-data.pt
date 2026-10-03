import type { FeedPolicy } from "#/index";
import { OOKLA_MAX_SOURCE_BYTES } from "./parquet";

/**
 * The terms both Ookla feeds are served under, as the dataset's README states them: CC BY-NC-SA 4.0, which travels
 * with the data (non-commercial reuse only, adaptations under the same licence), and the attribution Ookla suggests,
 * with what open-data.pt did to the data. No Ookla mark is shown: their trademarks need their written permission.
 */
export const OOKLA_TERMS = {
  licence: "cc-by-nc-sa-4.0",
  attribution:
    "Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps, accessed from AWS (s3://ookla-open-data) by open-data.pt when each quarter was collected. Based on open-data.pt's selection of the tiles that fall on Portugal, for the quarter each row names. Ookla trademarks used under license and reprinted with permission.",
  topics: ["telecom"],
} as const;

/**
 * Ookla adds a quarter a few weeks after it ends: a weekly listing finds it within days, and is one request when
 * nothing is new. A new quarter is some 20 to 50 MB of ranged reads, which `maxBytes` bounds; its 20,000 to 50,000
 * tiles are each one row.
 */
export const OOKLA_TILES_POLICY = {
  cadenceSeconds: 604_800,
  timeoutSeconds: 300,
  maxBytes: OOKLA_MAX_SOURCE_BYTES,
  maxOutputBytes: 64 * 1024 * 1024,
  maxRecordBytes: 2048,
  maxRecords: 150_000,
  historyMode: "changes",
} as const satisfies FeedPolicy;
