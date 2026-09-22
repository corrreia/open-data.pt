import { MAX_ARCHIVE_BYTES } from "./zip";

export const DAILY_STATIC = {
  name: "Daily GTFS static snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    // Large schedule archives can exceed five minutes including normalization
    // and storage on a cold Worker; keep the deadline explicit and bounded.
    timeoutSeconds: 600,
    // The archive streams entry by entry and is never buffered, so the source
    // budget is the whole compressed archive, stop_times.txt included.
    maxBytes: MAX_ARCHIVE_BYTES,
    maxOutputBytes: 48 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

/*
 * Most operators publish a schedule and say nothing about reuse: the archives
 * carry no `feed_license_url`, their sites carry no open-data page, and the
 * national access point that lists them states no licence of its own. Two do
 * say something (Carris Metropolitana and TCB), so they are served under what
 * they say rather than under the silence of their neighbours.
 */
export const LICENSED_DAILY_STATIC = {
  ...DAILY_STATIC,
  name: "Daily GTFS static snapshot, licensed",
} as const;
