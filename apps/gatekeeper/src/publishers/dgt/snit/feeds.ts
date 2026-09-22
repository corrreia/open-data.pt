import type { FeedDefinition } from "#/catalog/define";
import type { SnitType } from "./snit";

export const MEBIBYTE = 1024 * 1024;
const WEEK = 604_800;

/**
 * One feed per kind of instrument the register holds. The register is queried
 * a type at a time because asking for every type at once never answers: the
 * type is the seam the API itself offers.
 *
 * `timeoutSeconds` and `maxBytes` come from reading each type once: the master
 * plans are 278 instruments, 6.3 MB and 85 seconds; the detail plans are 687
 * instruments and 102 seconds; every other type answers in under six.
 */
export interface SnitRegister {
  type: SnitType;
  /** Measured wall time with room for a bad day; the floor is two minutes. */
  timeoutSeconds?: number;
  maxBytes?: number;
}

export function snitFeed(register: SnitRegister): FeedDefinition {
  return {
    slug: `snit-${register.type}-feed`,
    config: { source: "snit", feed: "instruments", type: register.type },
    policy: {
      name: "SNIT weekly register",
      version: 1,
      collection: {
        // An act reaches the register when it is published in the Diário da
        // República — a few a month across the whole system. Weekly catches one
        // within days; the master plans, the slowest query here, cost the
        // register about ninety seconds of work for that.
        cadenceSeconds: WEEK,
        timeoutSeconds: register.timeoutSeconds ?? 120,
        maxBytes: register.maxBytes ?? 4 * MEBIBYTE,
        maxRecordBytes: 256 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
    },
    // Two weeks: an act published the day after a run should not make the feed
    // look stale before the next run has had its chance at it.
    staleAfterSeconds: 2 * WEEK,
  };
}
