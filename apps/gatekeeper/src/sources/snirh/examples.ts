import type { ExampleFeed } from "../../index";
import { SNIRH_MAX_BYTES, SNIRH_READINGS, type SnirhReadingName } from "./snirh";

/**
 * A history slice of the busiest station network runs to about 60,000 points,
 * and every one of them is a revision the lake keeps. The server answers one
 * batch of 50 stations in 1 to 15 seconds depending on the hour, and the
 * weather network takes eleven batches plus the station list.
 */
const COLLECTION = {
  timeoutSeconds: 600,
  maxBytes: SNIRH_MAX_BYTES,
  maxOutputBytes: 16 * 1024 * 1024,
  maxRecordBytes: 4 * 1024,
  maxRecords: 150_000,
  historyMode: "changes",
} as const;

/**
 * The database takes in the telemetry of the day before in the small hours,
 * and a day's readings keep arriving after that; a few collections a day see
 * each of them within hours.
 */
const HOURLY_POLICY: ExampleFeed["policy"] = {
  name: "SNIRH hourly station readings",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 10_800 },
};

const DAILY_POLICY: ExampleFeed["policy"] = {
  name: "SNIRH daily station readings",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 21_600 },
};

/** Wells read by hand once a month, and bulletins published once a month: once a day is plenty. */
const MONTHLY_POLICY: ExampleFeed["policy"] = {
  name: "SNIRH monthly readings and bulletins",
  version: 1,
  collection: { ...COLLECTION, cadenceSeconds: 86_400 },
};

function reading(slug: string, name: SnirhReadingName, policy: ExampleFeed["policy"]): ExampleFeed {
  const definition = SNIRH_READINGS[name];
  return {
    slug,
    dataset: "apa-snirh-station-measurements",
    title: `Portugal ${definition.title.toLowerCase()}`,
    description: `${definition.description} Readings come from SNIRH's station database, usually within a day of being taken.`,
    config: { source: "snirh", feed: "readings", reading: name },
    policy,
    staleAfterSeconds: Math.max(172_800, policy.collection.cadenceSeconds * 3),
  };
}

export const SNIRH_EXAMPLES: ExampleFeed[] = [
  reading("snirh-river-levels-feed", "river-level", HOURLY_POLICY),
  reading("snirh-river-flows-feed", "river-flow", DAILY_POLICY),
  reading("snirh-reservoir-storage-feed", "reservoir-volume", DAILY_POLICY),
  reading("snirh-reservoir-levels-feed", "reservoir-level", DAILY_POLICY),
  reading("snirh-precipitation-feed", "precipitation", HOURLY_POLICY),
  reading("snirh-air-temperature-feed", "air-temperature", HOURLY_POLICY),
  reading("snirh-relative-humidity-feed", "relative-humidity", HOURLY_POLICY),
  reading("snirh-wind-speed-feed", "wind-speed", HOURLY_POLICY),
  reading("snirh-groundwater-levels-feed", "groundwater-level", MONTHLY_POLICY),
  {
    slug: "snirh-monthly-precipitation-feed",
    dataset: "apa-snirh-monthly-bulletins",
    title: "Portugal monthly precipitation",
    description:
      "Each finished month's precipitation at the stations of SNIRH's precipitation bulletin, with the station's monthly normal as a dimension. A month is published once it has ended.",
    config: { source: "snirh", feed: "monthly-precipitation" },
    policy: MONTHLY_POLICY,
    staleAfterSeconds: 259_200,
  },
  {
    slug: "snirh-reservoir-basins-feed",
    dataset: "apa-snirh-monthly-bulletins",
    title: "Portugal reservoir storage by river basin",
    description:
      "Water stored at the end of each month in the reservoirs of SNIRH's storage bulletin, per river basin, as a share of their total capacity. Each point is dated by the first day of its month.",
    config: { source: "snirh", feed: "reservoir-basins" },
    policy: MONTHLY_POLICY,
    staleAfterSeconds: 259_200,
  },
  {
    slug: "snirh-groundwater-state-feed",
    dataset: "apa-snirh-monthly-bulletins",
    title: "Portugal groundwater state by aquifer",
    description:
      "Each month's groundwater class for the aquifers of SNIRH's groundwater bulletin: whether their wells stood above the monthly mean, between the mean and the 20th percentile, or below it.",
    config: { source: "snirh", feed: "groundwater-state" },
    policy: MONTHLY_POLICY,
    staleAfterSeconds: 259_200,
  },
];
