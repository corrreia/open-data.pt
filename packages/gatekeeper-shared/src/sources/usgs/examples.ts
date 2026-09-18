import type { ExampleFeed } from "../../index";
import { USGS_MAX_BYTES, USGS_REGIONS } from "./usgs";

export const USGS_EXAMPLES: ExampleFeed[] = [
  example("usgs-mainland-portugal-earthquakes-feed", "Earthquakes around mainland Portugal", "mainland"),
  example("usgs-madeira-earthquakes-feed", "Earthquakes around Madeira", "madeira"),
  example("usgs-azores-earthquakes-feed", "Earthquakes around the Azores", "azores"),
];

function example(slug: string, title: string, region: keyof typeof USGS_REGIONS): ExampleFeed {
  return {
    slug,
    title,
    description: `Earthquakes of magnitude 1 or greater reported by the USGS during the past 30 days in the ${USGS_REGIONS[region].name} bounding region, including source updates and review status. The rectangle may include nearby international waters or Spain.`,
    config: { source: "usgs", feed: "earthquakes", region, days: "30", minMagnitude: "1" },
    publisher: "usgs",
    topics: ["environment"],
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
      serving: { licence: "usgs-public-domain", attribution: "U.S. Geological Survey" },
    },
  };
}
