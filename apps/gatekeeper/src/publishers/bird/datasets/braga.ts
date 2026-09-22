import type { DatasetDefinition } from "../../../catalog/define";
import { DAY_SECONDS, REALTIME_POLICY, referenceFeed } from "../../../formats/gbfs/feeds";
import { birdFeed } from "../gbfs";
import { PUBLISHER } from "../index";

// Bird Braga is an empty system: five vehicles that never move and a vehicle feed
// stamped `last_updated: 0`. Keeping the feed keeps its published state; polling it
// every five minutes buys nothing.
const EMPTY_SYSTEM_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS snapshots of an empty system, daily",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: DAY_SECONDS },
} as const;

export const DATASET: DatasetDefinition = {
  title: "Bird vehicles and station availability in Braga",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in Braga.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  feeds: [
    // Keep the pre-existing Braga definition: removing it would retire published state.
    // It is not counted among the new verified, nonempty fleet feeds.
    {
      ...birdFeed("braga", "Braga"),
      policy: EMPTY_SYSTEM_POLICY,
      staleAfterSeconds: 2 * DAY_SECONDS,
    },
    referenceFeed("bird-braga", PUBLISHER.name, "Braga", "https://mds.bird.co/gbfs/v2/public/braga/gbfs.json", "en"),
  ],
};
