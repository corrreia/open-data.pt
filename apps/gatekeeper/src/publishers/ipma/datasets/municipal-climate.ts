import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "IPMA daily municipal climate",
  description: "Daily precipitation and temperature for each mainland municipality, as IPMA publishes them.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  feeds: [
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
      },
      staleAfterSeconds: 3 * 86_400,
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
      },
      staleAfterSeconds: 3 * 86_400,
    },
  ],
};
