import type { ExampleFeed } from "../../index";

const SERVING = {
  licence: "metrolisboa-api",
  attribution: "Metropolitano de Lisboa",
} as const;

const PUBLISHER = "metropolitano-de-lisboa";
const TOPICS = ["mobility"];

export const METRO_LISBOA_EXAMPLES: ExampleFeed[] = [
  {
    slug: "metrolisboa-line-status-feed",
    title: "Metro Lisboa line status",
    description: "Whether each of the four Metro lines runs normally, and the service message when it does not.",
    config: { source: "metrolisboa", feed: "line-status" },
    policy: {
      name: "Metro Lisboa line status",
      version: 3,
      // Every change of a line's status is a disruption starting or ending: that is the history worth keeping.
      // A line's status changes about three times a day, so five minutes still catches a disruption while it matters.
      collection: { cadenceSeconds: 300, timeoutSeconds: 20, maxBytes: 64 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 600,
    publisher: PUBLISHER,
    topics: TOPICS,
  },
  {
    slug: "metrolisboa-waiting-times-feed",
    title: "Metro Lisboa waiting times",
    description: "The next three trains at every platform of the network, in seconds, with their destination.",
    config: { source: "metrolisboa", feed: "waiting-times" },
    policy: {
      name: "Metro Lisboa waiting times",
      version: 2,
      // Next-train times are a live reading that is out of date a minute later, not history.
      collection: { cadenceSeconds: 60, timeoutSeconds: 20, maxBytes: 512 * 1024, historyMode: "latest" },
      serving: SERVING,
    },
    staleAfterSeconds: 180,
    publisher: PUBLISHER,
    topics: TOPICS,
  },
  {
    slug: "metrolisboa-stations-feed",
    title: "Metro Lisboa stations",
    description: "Every Metro station with its position, lines, fare zone and page.",
    config: { source: "metrolisboa", feed: "stations" },
    policy: {
      name: "Metro Lisboa reference data",
      version: 1,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 30, maxBytes: 256 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 172_800,
    publisher: PUBLISHER,
    topics: TOPICS,
  },
  {
    slug: "metrolisboa-headways-feed",
    title: "Metro Lisboa scheduled headways",
    description: "The scheduled interval between trains on each line, by time of day, for weekdays and for weekends and holidays.",
    config: { source: "metrolisboa", feed: "headways" },
    policy: {
      name: "Metro Lisboa timetable",
      version: 1,
      collection: { cadenceSeconds: 86_400, timeoutSeconds: 60, maxBytes: 256 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 172_800,
    publisher: PUBLISHER,
    topics: TOPICS,
  },
];
