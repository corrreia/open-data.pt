import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { DOCKED_POLICY } from "#/formats/gbfs/feeds";

export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "bora-viseu",
  title: "Bora bicycles and station availability in Viseu Dão Lafões",
  description: "Current Bora bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  config: {
    url: "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json",
    language: "pt",
    feed: "status",
  },
  policy: DOCKED_POLICY,
  staleAfterSeconds: 1800,
  /** Every ten minutes: Bora's GBFS discovery document, then the system, vehicle-type, vehicle and station-status files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into bicycle positions, fleet counts and how much each station holds now. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
