import { defineFeed } from "#/catalog/define";
import { GBFS_DEPLOYMENT, GBFS_NORMALIZER, GBFS_TRANSFORMER, collectGbfsFeed } from "#/formats/gbfs/index";
import { REFERENCE_POLICY } from "#/formats/gbfs/feeds";

export const FEED = defineFeed(GBFS_DEPLOYMENT, {
  slug: "tubabike-barcelos-reference",
  title: "TubaBike stations and system information in Barcelos",
  description: "Where every TubaBike station in Barcelos is, what it is called, how much it holds, and who operates the system.",
  licence: "cc0-1.0",
  attribution: "TubaBike — Mobilidade de Barcelos",
  topics: ["mobility"],
  config: { url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json", language: "pt", feed: "reference" },
  policy: REFERENCE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: TubaBike's GBFS discovery document, then the system and station-information files it names. */
  fetch: ({ config, validator, library, fetch }) => collectGbfsFeed(config, validator, library.hosts, fetch),
  /** The system's files, read together, into what the system and each of its stations are. */
  transform: { normalizer: GBFS_NORMALIZER, buffered: (bytes, context) => GBFS_TRANSFORMER.transform(bytes, context) },
});
