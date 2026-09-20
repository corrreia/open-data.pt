import type { ExampleFeed } from "../../index";

/*
 * IPMA's conditions of use, which `api.ipma.pt` itself links to, allow copying
 * and use free of charge "para uso pessoal ou público desde que dessa
 * utilização não decorram finalidades lucrativas ou ofensivas", and ask that
 * the source always be named. A 2020 IPMA notice about this API says instead
 * that its open data may be "usados, reutilizados e redistribuídos
 * livremente"; the narrower of the two is what the catalogue states, so
 * whoever reuses these products sees the restriction rather than inheriting
 * silence.
 */
const SERVING = {
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
} as const;

export const IPMA_EXAMPLES: ExampleFeed[] = [
  {
    slug: "ipma-station-observations-feed",
    title: "IPMA hourly station observations",
    description: "The last 24 hours of temperature, humidity, wind, precipitation, and pressure readings from IPMA stations.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 7_200,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-daily-forecast-feed",
    title: "IPMA three-day city forecast",
    description: "Daily weather forecasts for Portuguese district capitals and islands for today and the following two days.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 3_600,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-seismic-feed",
    title: "IPMA seismic events",
    description: "The latest 30-day seismic event lists for mainland Portugal, Madeira, and the Azores.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 7_200,
    publisher: "ipma",
    topics: ["environment"],
  },
  {
    slug: "ipma-weather-warnings-feed",
    title: "IPMA weather warnings",
    description: "Weather warnings by district or island, with severity and validity periods.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 3_600,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-uv-index-feed",
    title: "IPMA UV index forecast",
    description: "Daily UV index forecasts by IPMA forecast location and period.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 28_800,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-fire-risk-feed",
    title: "IPMA municipal fire risk",
    description: "Three-day rural fire danger forecasts by municipality code.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 28_800,
    publisher: "ipma",
    topics: ["environment"],
  },
  {
    slug: "ipma-sea-forecast-feed",
    title: "IPMA three-day sea forecast",
    description: "Wave and sea-surface forecasts for Portuguese coastal locations for today and the following two days.",
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
      serving: SERVING,
    },
    staleAfterSeconds: 7_200,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-municipal-precipitation-feed",
    title: "IPMA daily municipal precipitation",
    description:
      "Spatial municipal means of interpolated daily precipitation totals and maximum precipitation rates in mainland Portugal. Collects the full 20-day source window; the bounded current-series view can contain fewer days, with the full collected window retained in history after delivery. Other source statistics, including spatial dispersion and quantiles, are not republished.",
    config: { source: "ipma", feed: "municipal-precipitation" },
    policy: {
      name: "IPMA daily municipal climate",
      version: 2,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 3 * 86_400,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-municipal-temperature-feed",
    title: "IPMA daily municipal temperature",
    description:
      "Spatial municipal means of interpolated daily minimum, mean and maximum air temperature in mainland Portugal. Collects the full 20-day source window; the bounded current-series view can contain fewer days, with the full collected window retained in history after delivery. Other source statistics, including spatial dispersion and quantiles, are not republished.",
    config: { source: "ipma", feed: "municipal-temperature" },
    policy: {
      name: "IPMA daily municipal climate",
      version: 2,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 3 * 86_400,
    publisher: "ipma",
    topics: ["environment", "weather"],
  },
  {
    slug: "ipma-shellfish-restrictions-feed",
    title: "IPMA shellfish harvesting restrictions",
    description:
      "Production-zone polygons and the latest published permissions and restrictions by marine species. Partially open zones retain their separate open and closed species lists; consult IPMA's official bulletin before harvesting.",
    config: { source: "ipma", feed: "shellfish-restrictions" },
    policy: {
      name: "IPMA shellfish bulletin",
      version: 2,
      collection: { cadenceSeconds: 21_600, timeoutSeconds: 90, maxBytes: 8 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxRecordBytes: 1024 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 86_400,
    publisher: "ipma",
    topics: ["environment", "health"],
  },
];
