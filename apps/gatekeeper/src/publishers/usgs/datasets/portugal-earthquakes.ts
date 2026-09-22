import type { DatasetDefinition, FeedDefinition } from "#/catalog/define";
import { USGS_MAX_BYTES, USGS_REGIONS } from "#/publishers/usgs/usgs/index";

export const DATASET: DatasetDefinition = {
  title: "USGS earthquakes around Portugal",
  description: "Earthquakes the USGS locates around mainland Portugal, Madeira and the Azores.",
  licence: "usgs-public-domain",
  attribution: "U.S. Geological Survey",
  topics: ["environment"],
  feeds: [
    regionFeed("usgs-mainland-portugal-earthquakes-feed", "Earthquakes around mainland Portugal", "mainland"),
    regionFeed("usgs-madeira-earthquakes-feed", "Earthquakes around Madeira", "madeira"),
    regionFeed("usgs-azores-earthquakes-feed", "Earthquakes around the Azores", "azores"),
  ],
};

function regionFeed(slug: string, title: string, region: keyof typeof USGS_REGIONS): FeedDefinition {
  return {
    slug,
    title,
    description: `Earthquakes of magnitude 1 or greater reported by the USGS during the past 30 days in the ${USGS_REGIONS[region].name} bounding region, including source updates and review status. The rectangle may include nearby international waters or Spain.`,
    config: { source: "usgs", feed: "earthquakes", region, days: "30", minMagnitude: "1" },
    staleAfterSeconds: 7200,
    policy: {
      name: "USGS rolling earthquake catalog",
      version: 1,
      collection: {
        cadenceSeconds: 3600,
        timeoutSeconds: 60,
        maxBytes: USGS_MAX_BYTES,
        maxOutputBytes: 12 * 1024 * 1024,
        maxRecordBytes: 32 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
    },
  };
}
