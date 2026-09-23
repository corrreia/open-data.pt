import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { DAY_SECONDS, REALTIME_POLICY } from "#/formats/gbfs/feeds";

// Bird Braga is an empty system: five vehicles that never move and a vehicle feed
// stamped `last_updated: 0`. Keeping the feed keeps its published state; polling it
// every five minutes buys nothing.
const EMPTY_SYSTEM_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS snapshots of an empty system, daily",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: DAY_SECONDS },
} as const;

// Keep the pre-existing Braga definition: removing it would retire published state.
// It is not counted among the new verified, nonempty fleet feeds.
export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "bird-braga",
  title: "Bird vehicles and station availability in Braga",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in Braga.",
  config: {
    url: "https://mds.bird.co/gbfs/v2/public/braga/gbfs.json",
    language: "en",
    feed: "status",
  },
  policy: EMPTY_SYSTEM_POLICY,
  staleAfterSeconds: 2 * DAY_SECONDS,
  /** Once a day: Bird Braga's GBFS discovery document, then the system, vehicle-type, vehicle and station-status files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into vehicle positions, fleet counts and how much each station holds now. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
