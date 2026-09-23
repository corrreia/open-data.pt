import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-members-xvii-feed",
  title: "Parliament XVII: published mandates and reference",
  description:
    "All mandates published in the XVII legislature file, including renounced and other source statuses, with constituencies, parliamentary groups and sessions. Not a list restricted to currently active MPs.",
  config: { feed: "members", legislature: "XVII" },
  policy: parliamentPolicy("members", 86_400),
  staleAfterSeconds: 259_200,
  /** Once a day: the XVII mandates file, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
