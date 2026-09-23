import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { REALTIME_POLICY } from "#/formats/gbfs/feeds";

export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "bird-lisbon",
  title: "Bird vehicles and station availability in Lisbon",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each Lisbon virtual station holds.",
  config: {
    url: "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json",
    language: "en",
    feed: "status",
  },
  policy: REALTIME_POLICY,
  staleAfterSeconds: 600,
  /** Every three minutes: Bird Lisbon's GBFS discovery document, then the system, vehicle-type, vehicle and station-status files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into vehicle positions, fleet counts and how much each station holds now. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
