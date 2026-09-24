import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { BIRD_POLICY } from "#/publishers/bird/gbfs";

export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "bird-porto",
  title: "Bird vehicles and station availability in Porto",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in Porto.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  config: {
    url: "https://mds.bird.co/gbfs/v2/public/porto/gbfs.json",
    language: "en",
    feed: "status",
  },
  policy: BIRD_POLICY,
  staleAfterSeconds: 900,
  /** Every five minutes: Bird Porto's GBFS discovery document, then the system, vehicle-type, vehicle and station-status files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into vehicle positions, fleet counts and how much each station holds now. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
