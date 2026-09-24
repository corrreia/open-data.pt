import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { REFERENCE_POLICY } from "#/formats/gbfs/feeds";

export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "bird-porto-reference",
  title: "Bird stations and system information in Porto",
  description: "Where every Bird station in Porto is, what it is called, how much it holds, and who operates the system.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  config: { url: "https://mds.bird.co/gbfs/v2/public/porto/gbfs.json", language: "en", feed: "reference" },
  policy: REFERENCE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: Bird Porto's GBFS discovery document, then the system and station-information files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into what the system and each of its stations are. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
