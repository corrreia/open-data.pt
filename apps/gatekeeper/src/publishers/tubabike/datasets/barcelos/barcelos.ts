import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { DOCKED_POLICY } from "#/formats/gbfs/feeds";

// Collected under a policy of its own, as TubaBike states a licence (see the dataset).
const TUBABIKE_POLICY = { ...DOCKED_POLICY, name: "GBFS docked system snapshots, ten minutes, dedicated" } as const;
export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "tubabike-barcelos",
  title: "TubaBike bicycles and station availability in Barcelos",
  description: "Current TubaBike bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
  config: {
    url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json",
    language: "pt",
    feed: "status",
  },
  policy: TUBABIKE_POLICY,
  staleAfterSeconds: 1800,
  /** Every ten minutes: TubaBike's GBFS discovery document, then the system, vehicle-type, vehicle and station-status files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into bicycle positions, fleet counts and how much each station holds now. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
