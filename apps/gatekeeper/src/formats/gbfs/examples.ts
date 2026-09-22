import { PUBLISHERS, type ExampleFeed, type Publisher } from "../../index";

const DAY_SECONDS = 86_400;

const REALTIME_POLICY = {
  name: "GBFS realtime snapshots",
  version: 4,
  collection: {
    cadenceSeconds: 180,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
    // Vehicles move on every collection, and Bird's stations are virtual spots whose counts wobble with them:
    // their revisions are noise, over a million lake rows a day. The fleet series records the counts on every collection.
    withoutHistory: ["vehicles", "stations"],
  },
} as const;

// Docked systems have real stations, a few dozen each: how full a dock was is history worth keeping. Their vehicles are not.
const DOCKED_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS docked system snapshots, ten minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 600, withoutHistory: ["vehicles"] },
} as const;

/*
 * TubaBike is the one system here that fills GBFS's own licence field —
 * `"license_id": "CC0-1.0"` in its `system_information.json` — which is why its
 * feeds are collected under policies of their own.
 */
const TUBABIKE_POLICY = { ...DOCKED_POLICY, name: "GBFS docked system snapshots, ten minutes, dedicated" } as const;

// Bird advertises a 60-second TTL; a five-minute public snapshot avoids
// hammering the operator while retaining useful municipal fleet counts.
const BIRD_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS Bird snapshots, five minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 300 },
} as const;

// Bird Braga is an empty system: five vehicles that never move and a vehicle feed
// stamped `last_updated: 0`. Keeping the feed keeps its published state; polling it
// every five minutes buys nothing.
const EMPTY_SYSTEM_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS snapshots of an empty system, daily",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: DAY_SECONDS },
} as const;

// What a station and a system *are*: read once a day, because that is how often it changes.
const REFERENCE_POLICY = {
  name: "GBFS system and station reference, daily",
  version: 1,
  collection: {
    cadenceSeconds: DAY_SECONDS,
    timeoutSeconds: 30,
    maxBytes: 4 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

const TUBABIKE_REFERENCE_POLICY = { ...REFERENCE_POLICY, name: "GBFS system and station reference, daily, dedicated" } as const;

export const GBFS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "bird-lisbon",
    dataset: "bird-lisbon",
    title: "Bird vehicles and station availability in Lisbon",
    description: "Current Bird vehicle positions, fleet counts, and how many vehicles each Lisbon virtual station holds.",
    config: {
      source: "gbfs",
      url: "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json",
      language: "en",
      feed: "status",
    },
    policy: REALTIME_POLICY,
    staleAfterSeconds: 600,
  },
  // Keep the pre-existing Braga definition: removing it would retire published state.
  // It is not counted among the new verified, nonempty fleet feeds.
  {
    ...birdExample("braga", "Braga"),
    policy: EMPTY_SYSTEM_POLICY,
    staleAfterSeconds: 2 * DAY_SECONDS,
  },
  birdExample("cascais", "Cascais"),
  birdExample("matosinhos", "Matosinhos"),
  birdExample("porto", "Porto"),
  {
    slug: "bora-viseu",
    dataset: "bora-viseu",
    title: "Bora bicycles and station availability in Viseu Dão Lafões",
    description: "Current Bora bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
    config: {
      source: "gbfs",
      url: "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json",
      language: "pt",
      feed: "status",
    },
    policy: DOCKED_POLICY,
    staleAfterSeconds: 1800,
  },
  {
    slug: "tubabike-barcelos",
    dataset: "tubabike-barcelos",
    title: "TubaBike bicycles and station availability in Barcelos",
    description: "Current TubaBike bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
    config: {
      source: "gbfs",
      url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json",
      language: "pt",
      feed: "status",
    },
    policy: TUBABIKE_POLICY,
    staleAfterSeconds: 1800,
  },
  referenceExample("bird-lisbon", "bird", "Lisbon", "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json", "en"),
  referenceExample("bird-braga", "bird", "Braga", "https://mds.bird.co/gbfs/v2/public/braga/gbfs.json", "en"),
  referenceExample("bird-cascais", "bird", "Cascais", "https://mds.bird.co/gbfs/v2/public/cascais/gbfs.json", "en"),
  referenceExample("bird-matosinhos", "bird", "Matosinhos", "https://mds.bird.co/gbfs/v2/public/matosinhos/gbfs.json", "en"),
  referenceExample("bird-porto", "bird", "Porto", "https://mds.bird.co/gbfs/v2/public/porto/gbfs.json", "en"),
  referenceExample("bora-viseu", "bora", "Viseu Dão Lafões", "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json", "pt"),
  referenceExample("tubabike-barcelos", "tubabike", "Barcelos", "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json", "pt", TUBABIKE_REFERENCE_POLICY),
];

function birdExample(slug: string, city: string): ExampleFeed {
  return {
    slug: `bird-${slug}`,
    dataset: `bird-${slug}`,
    title: `Bird vehicles and station availability in ${city}`,
    description: `Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in ${city}.`,
    config: {
      source: "gbfs",
      url: `https://mds.bird.co/gbfs/v2/public/${slug}/gbfs.json`,
      language: "en",
      feed: "status",
    },
    policy: BIRD_POLICY,
    staleAfterSeconds: 900,
  };
}

/**
 * The slow half of a system, beside the feed of the same name: the station
 * slug keeps its history, and this one carries what the status feed used to
 * re-download on every collection.
 */
function referenceExample(statusSlug: string, publisher: Publisher, place: string, url: string, language: string, policy: ExampleFeed["policy"] = REFERENCE_POLICY): ExampleFeed {
  const operator = PUBLISHERS[publisher].name;
  return {
    slug: `${statusSlug}-reference`,
    dataset: statusSlug,
    title: `${operator} stations and system information in ${place}`,
    description: `Where every ${operator} station in ${place} is, what it is called, how much it holds, and who operates the system.`,
    config: { source: "gbfs", url, language, feed: "reference" },
    policy,
    staleAfterSeconds: 2 * DAY_SECONDS,
  };
}
