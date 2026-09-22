import type { ExampleFeed } from "../../index";
import { INFOAGUA_MAX_BYTES } from "./infoagua";

/** InfoÁgua states no terms of its own. */
const SERVING = { licence: "source-terms", attribution: "InfoÁgua, Agência Portuguesa do Ambiente" } as const;

export const INFOAGUA_EXAMPLES: ExampleFeed[] = [
  {
    slug: "infoagua-flood-alerts-feed",
    title: "Portugal flood alerts by station",
    description:
      "The flood alert level APA's InfoÁgua shows for each river, rain and reservoir station it watches, kept as a history of every change. The readings behind the alerts are in the SNIRH feeds.",
    config: { source: "infoagua", feed: "flood-alerts" },
    policy: {
      name: "InfoÁgua flood alerts",
      version: 1,
      // A station's alert follows its hourly reading; a quarter-hour cadence sees a change within the hour it happens.
      collection: { cadenceSeconds: 900, timeoutSeconds: 60, maxBytes: INFOAGUA_MAX_BYTES, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 3_600,
    publisher: "apa",
    topics: ["environment", "weather"],
  },
  {
    slug: "infoagua-drought-index-feed",
    title: "Portugal hydrological drought index by basin",
    description: "The monthly hydrological drought index and state of each river basin, as APA's InfoÁgua publishes it: wet, normal, or a hydrological drought of rising severity.",
    config: { source: "infoagua", feed: "drought-index" },
    policy: {
      name: "InfoÁgua drought index",
      version: 1,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 60, maxBytes: INFOAGUA_MAX_BYTES, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 259_200,
    publisher: "apa",
    topics: ["environment", "weather"],
  },
];
