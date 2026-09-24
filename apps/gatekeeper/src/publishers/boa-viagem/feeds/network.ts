import { defineFeed } from "#/catalog/define";
import { MYINFO_DEPLOYMENT, MYINFO_NORMALIZER, MYINFO_TRANSFORMER, collectMyInfoFeed } from "#/formats/myinfo/index";
import { MYINFO_NETWORK_POLICY } from "#/formats/myinfo/feeds";
import { runTransformer } from "#/index";

export const FEED = defineFeed(MYINFO_DEPLOYMENT, {
  slug: "boa-viagem-network-feed",
  title: "Boa Viagem stops and lines",
  description: "Every bus stop Boa Viagem serves north of Lisbon, with its position, and every line and direction it runs.",
  licence: "source-terms",
  attribution: "Boa Viagem via myinfo.4cloud.pt",
  topics: ["mobility"],
  config: { feed: "network", operator: "BoaViagem" },
  policy: MYINFO_NETWORK_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: the operator's portal page, which carries its whole stop network inline. */
  fetch: ({ config, validator, library, fetch }) => collectMyInfoFeed(config, validator, library.apiOrigin, library.operators, fetch),
  /** The portal's answer, as MYINFO lays it out, into stops and lines. */
  transform: { normalizer: MYINFO_NORMALIZER, buffered: (bytes, context) => runTransformer(MYINFO_TRANSFORMER, bytes, context) },
});
