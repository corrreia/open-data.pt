import type { ExampleFeed } from "../../index";

const DAY_SECONDS = 86_400;

const REALTIME_POLICY = {
  name: "GBFS realtime snapshots",
  version: 4,
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

// Lime answered 34 of 200 collections with HTTP 429 at five-minute polling, so it gets ten.
const LIME_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS realtime snapshots, ten minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 600 },
} as const;

// Docked systems have real stations, a few dozen each: how full a dock was is history worth keeping. Their vehicles are not.
const DOCKED_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS docked system snapshots, ten minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 600, withoutHistory: ["vehicles"] },
} as const;

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
  serving: {
    licence: "Source terms apply",
    attribution: "The GBFS system operator",
  },
} as const;

export const GBFS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "lime-lisbon",
    title: "Lime vehicles and station availability in Lisbon",
    description: "Current Lime vehicle positions, fleet counts, and how many vehicles each Lisbon station holds.",
    config: {
      source: "gbfs",
      url: "https://data.lime.bike/api/partners/v1/gbfs/lisbon/gbfs.json",
      language: "en",
      feed: "status",
    },
    policy: LIME_POLICY,
    staleAfterSeconds: 1800,
    publisher: "Lime",
    topics: ["mobility"],
  },
  {
    slug: "bird-lisbon",
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
    publisher: "Bird",
    topics: ["mobility"],
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
    publisher: "Bora",
    topics: ["mobility"],
  },
  {
    slug: "tubabike-barcelos",
    title: "TubaBike bicycles and station availability in Barcelos",
    description: "Current TubaBike bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
    config: {
      source: "gbfs",
      url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json",
      language: "pt",
      feed: "status",
    },
    policy: DOCKED_POLICY,
    staleAfterSeconds: 1800,
    publisher: "TubaBike",
    topics: ["mobility"],
  },
  referenceExample("lime-lisbon", "Lime", "Lisbon", "https://data.lime.bike/api/partners/v1/gbfs/lisbon/gbfs.json", "en"),
  referenceExample("bird-lisbon", "Bird", "Lisbon", "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json", "en"),
  referenceExample("bird-braga", "Bird", "Braga", "https://mds.bird.co/gbfs/v2/public/braga/gbfs.json", "en"),
  referenceExample("bird-cascais", "Bird", "Cascais", "https://mds.bird.co/gbfs/v2/public/cascais/gbfs.json", "en"),
  referenceExample("bird-matosinhos", "Bird", "Matosinhos", "https://mds.bird.co/gbfs/v2/public/matosinhos/gbfs.json", "en"),
  referenceExample("bird-porto", "Bird", "Porto", "https://mds.bird.co/gbfs/v2/public/porto/gbfs.json", "en"),
  referenceExample("bora-viseu", "Bora", "Viseu Dão Lafões", "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json", "pt"),
  referenceExample("tubabike-barcelos", "TubaBike", "Barcelos", "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json", "pt"),
];

function birdExample(slug: string, city: string): ExampleFeed {
  return {
    slug: `bird-${slug}`,
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
    publisher: "Bird",
    topics: ["mobility"],
  };
}

/**
 * The slow half of a system, beside the feed of the same name: the station
 * slug keeps its history, and this one carries what the status feed used to
 * re-download on every collection.
 */
function referenceExample(statusSlug: string, publisher: string, place: string, url: string, language: string): ExampleFeed {
  return {
    slug: `${statusSlug}-reference`,
    title: `${publisher} stations and system information in ${place}`,
    description: `Where every ${publisher} station in ${place} is, what it is called, how much it holds, and who operates the system.`,
    config: { source: "gbfs", url, language, feed: "reference" },
    policy: REFERENCE_POLICY,
    staleAfterSeconds: 2 * DAY_SECONDS,
    publisher,
    topics: ["mobility"],
  };
}
