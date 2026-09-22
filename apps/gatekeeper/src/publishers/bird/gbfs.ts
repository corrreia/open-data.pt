import type { FeedDefinition } from "#/catalog/define";
import { REALTIME_POLICY } from "#/formats/gbfs/feeds";

// Bird advertises a 60-second TTL; a five-minute public snapshot avoids
// hammering the operator while retaining useful municipal fleet counts.
export const BIRD_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS Bird snapshots, five minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 300 },
} as const;

/** One Bird city's vehicles and virtual stations, as its public GBFS system publishes them. */
export function birdFeed(city: string, place: string): FeedDefinition {
  return {
    slug: `bird-${city}`,
    title: `Bird vehicles and station availability in ${place}`,
    description: `Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in ${place}.`,
    config: {
      source: "gbfs",
      url: `https://mds.bird.co/gbfs/v2/public/${city}/gbfs.json`,
      language: "en",
      feed: "status",
    },
    policy: BIRD_POLICY,
    staleAfterSeconds: 900,
  };
}
