import type { FeedDefinition } from "../../catalog/define";

export const DAY_SECONDS = 86_400;

export const REALTIME_POLICY = {
  name: "GBFS realtime snapshots",
  version: 4,
  collection: {
    cadenceSeconds: 180,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
    // Vehicles move on every collection, and Bird's stations are virtual spots whose counts wobble with them:
    // their revisions are noise, over a million lake rows a day. The fleet series records the counts on every collection.
    withoutHistory: ["vehicles", "stations"],
  },
} as const;

// Docked systems have real stations, a few dozen each: how full a dock was is history worth keeping. Their vehicles are not.
export const DOCKED_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS docked system snapshots, ten minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 600, withoutHistory: ["vehicles"] },
} as const;

// What a station and a system *are*: read once a day, because that is how often it changes.
export const REFERENCE_POLICY = {
  name: "GBFS system and station reference, daily",
  version: 1,
  collection: {
    cadenceSeconds: DAY_SECONDS,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

/**
 * The slow half of a system, beside the feed of the same name: the station
 * slug keeps its history, and this one carries what the status feed used to
 * re-download on every collection.
 */
export function referenceFeed(
  statusSlug: string,
  operator: string,
  place: string,
  url: string,
  language: string,
  policy: FeedDefinition["policy"] = REFERENCE_POLICY,
): FeedDefinition {
  return {
    slug: `${statusSlug}-reference`,
    title: `${operator} stations and system information in ${place}`,
    description: `Where every ${operator} station in ${place} is, what it is called, how much it holds, and who operates the system.`,
    config: { source: "gbfs", url, language, feed: "reference" },
    policy,
    staleAfterSeconds: 2 * DAY_SECONDS,
  };
}
