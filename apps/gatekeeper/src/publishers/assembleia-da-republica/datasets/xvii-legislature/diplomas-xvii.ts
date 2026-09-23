import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-diplomas-xvii-feed",
  title: "Parliament XVII: approved legislation",
  description:
    "Approved legislation with official identifiers, titles, types, publication metadata and official text links. Publication dates are source dates, not collection times.",
  config: { feed: "diplomas", legislature: "XVII" },
  policy: parliamentPolicy("diplomas", 86_400),
  staleAfterSeconds: 259_200,
  /** Once a day: the XVII approved-legislation file, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
