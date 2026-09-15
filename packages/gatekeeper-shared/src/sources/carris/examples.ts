import type { ExampleFeed } from "../../index";

const SERVING = {
  licence: "Source terms apply",
  attribution: "Carris Metropolitana",
} as const;

const REFERENCE = {
  name: "Carris reference data",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 30,
    maxBytes: 12 * 1024 * 1024,
    historyMode: "changes",
  },
  serving: SERVING,
} as const;

export const CARRIS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "carris-lines-feed",
    title: "Carris Metropolitana lines",
    description: "Slow-changing transit line reference data.",
    config: { source: "carris", feed: "lines" },
    policy: REFERENCE,
    staleAfterSeconds: 172_800,
    publisher: "Carris Metropolitana",
    topics: ["mobility"],
  },
  {
    slug: "carris-routes-feed",
    title: "Carris Metropolitana routes",
    description: "Route variants of each line, with colours and served municipalities.",
    config: { source: "carris", feed: "routes" },
    policy: REFERENCE,
    staleAfterSeconds: 172_800,
    publisher: "Carris Metropolitana",
    topics: ["mobility"],
  },
  {
    slug: "carris-stops-feed",
    title: "Carris Metropolitana stops",
    description: "Every stop in the network with its location and served lines.",
    config: { source: "carris", feed: "stops" },
    // About 13,000 stops in a 6.8 MB response, close to the 16 MiB default output cap.
    policy: {
      ...REFERENCE,
      collection: { ...REFERENCE.collection, maxOutputBytes: 64 * 1024 * 1024 },
    },
    staleAfterSeconds: 172_800,
    publisher: "Carris Metropolitana",
    topics: ["mobility"],
  },
  {
    slug: "carris-vehicles-feed",
    title: "Carris Metropolitana vehicle positions",
    description: "Near-real-time current vehicle state with minute summaries.",
    config: { source: "carris", feed: "vehicles" },
    policy: {
      name: "Carris realtime state",
      version: 4,
      collection: {
        cadenceSeconds: 60,
        timeoutSeconds: 20,
        maxBytes: 10 * 1024 * 1024,
        historyMode: "changes",
        // Positions move every minute: their revisions are noise, not history (about 1.1 million lake rows a day).
        // The fleet summary repeats the counts the active-vehicles series records. That series keeps every minute.
        withoutHistory: ["vehicles-current", "fleet-summary"],
      },
      serving: SERVING,
    },
    staleAfterSeconds: 180,
    publisher: "Carris Metropolitana",
    topics: ["mobility"],
  },
  {
    slug: "carris-alerts-feed",
    title: "Carris Metropolitana service alerts",
    description: "Current service disruptions with correction history.",
    config: { source: "carris", feed: "alerts" },
    policy: {
      name: "Carris service alerts",
      version: 1,
      collection: {
        cadenceSeconds: 300,
        timeoutSeconds: 20,
        maxBytes: 2 * 1024 * 1024,
        historyMode: "changes",
      },
      serving: SERVING,
    },
    staleAfterSeconds: 900,
    publisher: "Carris Metropolitana",
    topics: ["mobility"],
  },
];
