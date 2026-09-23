import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { REFERENCE_POLICY } from "#/formats/gbfs/feeds";

export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "bora-viseu-reference",
  title: "Bora stations and system information in Viseu Dão Lafões",
  description: "Where every Bora station in Viseu Dão Lafões is, what it is called, how much it holds, and who operates the system.",
  config: { url: "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json", language: "pt", feed: "reference" },
  policy: REFERENCE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: Bora's GBFS discovery document, then the system and station-information files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into what the system and each of its stations are. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
