import type { ExampleFeed } from "../../index";

export const IPMA_EXAMPLES: ExampleFeed[] = [
  {
    slug: "ipma-station-observations-feed",
    dataset: "ipma-station-observations",
    config: { source: "ipma", feed: "station-observations" },
    policy: {
      name: "IPMA hourly observations",
      version: 5,
      collection: {
        cadenceSeconds: 3_600,
        timeoutSeconds: 30,
        maxBytes: 3 * 1024 * 1024,
        historyMode: "changes",
        // The latest reading per station repeats values the observations series already records.
        withoutHistory: ["stations-latest"],
      },
    },
    staleAfterSeconds: 7_200,
  },
  {
    slug: "ipma-daily-forecast-feed",
    dataset: "ipma-daily-forecast",
    config: { source: "ipma", feed: "daily-forecast" },
    policy: {
      name: "IPMA forecast reference",
      version: 3,
      collection: {
        cadenceSeconds: 3_600,
        timeoutSeconds: 30,
        maxBytes: 2 * 1024 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 3_600,
  },
  {
    slug: "ipma-seismic-feed",
    dataset: "ipma-seismic",
    config: { source: "ipma", feed: "seismic" },
    policy: {
      name: "IPMA seismic changes",
      version: 3,
      collection: {
        cadenceSeconds: 3_600,
        timeoutSeconds: 30,
        maxBytes: 2 * 1024 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 7_200,
  },
  {
    slug: "ipma-weather-warnings-feed",
    dataset: "ipma-weather-warnings",
    config: { source: "ipma", feed: "warnings" },
    policy: {
      name: "IPMA warning changes",
      version: 3,
      collection: {
        cadenceSeconds: 1_800,
        timeoutSeconds: 30,
        maxBytes: 128 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 3_600,
  },
  {
    slug: "ipma-uv-index-feed",
    dataset: "ipma-uv-index",
    config: { source: "ipma", feed: "uv-index" },
    policy: {
      name: "IPMA UV forecast reference",
      version: 2,
      collection: {
        cadenceSeconds: 14_400,
        timeoutSeconds: 30,
        maxBytes: 128 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 28_800,
  },
  {
    slug: "ipma-fire-risk-feed",
    dataset: "ipma-fire-risk",
    config: { source: "ipma", feed: "fire-risk" },
    policy: {
      name: "IPMA fire-risk current state",
      version: 2,
      collection: {
        cadenceSeconds: 14_400,
        timeoutSeconds: 30,
        maxBytes: 128 * 1024,
        historyMode: "latest",
      },
    },
    staleAfterSeconds: 28_800,
  },
  {
    slug: "ipma-sea-forecast-feed",
    dataset: "ipma-sea-forecast",
    config: { source: "ipma", feed: "sea-forecast" },
    policy: {
      name: "IPMA sea forecast reference",
      version: 3,
      collection: {
        cadenceSeconds: 3_600,
        timeoutSeconds: 30,
        maxBytes: 64 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 7_200,
  },
  {
    slug: "ipma-municipal-precipitation-feed",
    dataset: "ipma-municipal-climate",
    title: "IPMA daily municipal precipitation",
    description:
      "Spatial municipal means of interpolated daily precipitation totals and maximum precipitation rates in mainland Portugal. Collects the full 20-day source window; the bounded current-series view can contain fewer days, with the full collected window retained in history after delivery. Other source statistics, including spatial dispersion and quantiles, are not republished.",
    config: { source: "ipma", feed: "municipal-precipitation" },
    policy: {
      name: "IPMA daily municipal climate",
      version: 2,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 3 * 86_400,
  },
  {
    slug: "ipma-municipal-temperature-feed",
    dataset: "ipma-municipal-climate",
    title: "IPMA daily municipal temperature",
    description:
      "Spatial municipal means of interpolated daily minimum, mean and maximum air temperature in mainland Portugal. Collects the full 20-day source window; the bounded current-series view can contain fewer days, with the full collected window retained in history after delivery. Other source statistics, including spatial dispersion and quantiles, are not republished.",
    config: { source: "ipma", feed: "municipal-temperature" },
    policy: {
      name: "IPMA daily municipal climate",
      version: 2,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 3 * 86_400,
  },
  {
    slug: "ipma-shellfish-restrictions-feed",
    dataset: "ipma-shellfish-restrictions",
    config: { source: "ipma", feed: "shellfish-restrictions" },
    policy: {
      name: "IPMA shellfish bulletin",
      version: 2,
      collection: { cadenceSeconds: 21_600, timeoutSeconds: 90, maxBytes: 8 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxRecordBytes: 1024 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 86_400,
  },
];
