import type { DatasetDefinition, FeedDefinition } from "../../../catalog/define";
import { FIRMS_DAY_RANGE, FIRMS_MAX_BYTES, FIRMS_REGIONS } from "../firms";

export const DATASET: DatasetDefinition = {
  title: "NASA FIRMS thermal anomalies",
  description: "Satellite thermal anomalies — the signature of an active fire — around mainland Portugal, Madeira and the Azores.",
  licence: "nasa-earthdata",
  attribution: "NASA FIRMS, part of NASA's Earth Science Data and Information System (ESDIS)",
  topics: ["environment"],
  feeds: [
    regionFeed("nasa-firms-mainland-thermal-anomalies-feed", "NASA FIRMS thermal anomalies around mainland Portugal", "mainland"),
    regionFeed("nasa-firms-madeira-thermal-anomalies-feed", "NASA FIRMS thermal anomalies around Madeira", "madeira"),
    regionFeed("nasa-firms-azores-thermal-anomalies-feed", "NASA FIRMS thermal anomalies around the Azores", "azores"),
  ],
};

function regionFeed(slug: string, title: string, region: keyof typeof FIRMS_REGIONS): FeedDefinition {
  return {
    slug,
    title,
    description: `VIIRS Suomi-NPP near-real-time thermal-anomaly pixels detected during the past ${FIRMS_DAY_RANGE} days in the ${FIRMS_REGIONS[region].name} bounding region. A pixel is not a confirmed wildfire, exact ignition point or burnt-area perimeter.`,
    config: { source: "firms", feed: "hotspots", region, product: "VIIRS_SNPP_NRT" },
    staleAfterSeconds: 21_600,
    policy: {
      name: "NASA FIRMS near-real-time thermal anomalies",
      version: 1,
      collection: {
        cadenceSeconds: 10_800,
        timeoutSeconds: 60,
        maxBytes: FIRMS_MAX_BYTES,
        maxOutputBytes: 12 * 1024 * 1024,
        maxRecordBytes: 16 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
    },
  };
}
