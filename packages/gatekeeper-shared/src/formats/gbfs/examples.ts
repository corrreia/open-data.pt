import type { ExampleFeed } from "../../index";

const REALTIME_POLICY = {
  name: "GBFS realtime snapshots",
  version: 3,
  collection: {
    cadenceSeconds: 180,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
    // Vehicles move on every collection, and Bird's and Lime's stations are virtual spots whose counts wobble with them:
    // their revisions are noise, over a million lake rows a day. The fleet series records the counts on every collection.
    withoutHistory: ["vehicles", "stations"],
  },
  serving: {
    licence: "Source terms apply",
    attribution: "The GBFS system operator",
  },
} as const;

// Lime rate-limits the vehicle feed (HTTP 429 at two-minute polling), so it
// gets a slower policy than the other operators.
const LIME_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS realtime snapshots, five minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 300 },
} as const;

// Docked systems have real stations, a few dozen each: how full a dock was is history worth keeping. Their vehicles are not.
const DOCKED_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS docked system snapshots",
  collection: { ...REALTIME_POLICY.collection, withoutHistory: ["vehicles"] },
} as const;

// Bora's feed changes about every ten minutes (measured 2026-09-08).
const BORA_POLICY = {
  ...DOCKED_POLICY,
  name: "GBFS docked system snapshots, ten minutes",
  collection: { ...DOCKED_POLICY.collection, cadenceSeconds: 600 },
} as const;

// Bird advertises a 60-second TTL; a five-minute public snapshot avoids
// hammering the operator while retaining useful municipal fleet counts.
const BIRD_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS Bird snapshots, five minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 300 },
} as const;

export const GBFS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "lime-lisbon",
    title: "Lime vehicles and stations in Lisbon",
    description: "Current Lime vehicle positions, station state, fleet counts, and system information for Lisbon.",
    config: {
      source: "gbfs",
      url: "https://data.lime.bike/api/partners/v1/gbfs/lisbon/gbfs.json",
      language: "en",
    },
    policy: LIME_POLICY,
    staleAfterSeconds: 900,
    publisher: "Lime",
    topics: ["mobility"],
  },
  {
    slug: "bird-lisbon",
    title: "Bird vehicles and stations in Lisbon",
    description: "Current Bird vehicle positions, virtual station state, fleet counts, and system information for Lisbon.",
    config: {
      source: "gbfs",
      url: "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json",
      language: "en",
    },
    policy: REALTIME_POLICY,
    staleAfterSeconds: 600,
    publisher: "Bird",
    topics: ["mobility"],
  },
  // Keep the pre-existing Braga definition: removing it would retire published state.
  // It is not counted among the new verified, nonempty fleet feeds.
  birdExample("braga", "Braga"),
  birdExample("cascais", "Cascais"),
  birdExample("matosinhos", "Matosinhos"),
  birdExample("porto", "Porto"),
  {
    slug: "bora-viseu",
    title: "Bora bicycles and stations in Viseu Dão Lafões",
    description: "Current Bora bicycle positions, docked station state, fleet counts, and system information for Viseu Dão Lafões.",
    config: {
      source: "gbfs",
      url: "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json",
      language: "pt",
    },
    policy: BORA_POLICY,
    staleAfterSeconds: 600,
    publisher: "Bora",
    topics: ["mobility"],
  },
  {
    slug: "tubabike-barcelos",
    title: "TubaBike bicycles and stations in Barcelos",
    description: "Current TubaBike bicycle positions, station state, fleet counts, and system information for Barcelos.",
    config: {
      source: "gbfs",
      url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json",
      language: "pt",
    },
    policy: DOCKED_POLICY,
    staleAfterSeconds: 600,
    publisher: "TubaBike",
    topics: ["mobility"],
  },
];

function birdExample(slug: string, city: string): ExampleFeed {
  return {
    slug: `bird-${slug}`,
    title: `Bird vehicles and stations in ${city}`,
    description: `Current Bird vehicle positions, virtual station state, fleet counts, and system information for ${city}.`,
    config: {
      source: "gbfs",
      url: `https://mds.bird.co/gbfs/v2/public/${slug}/gbfs.json`,
      language: "en",
    },
    policy: BIRD_POLICY,
    staleAfterSeconds: 900,
    publisher: "Bird",
    topics: ["mobility"],
  };
}
