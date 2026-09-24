import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-petitions-xvii-feed",
  title: "Parliament XVII: petitions",
  description:
    "Petition headlines, processing status, signature counts, source dates and committee metadata. Does not republish petition authors' personal submissions or nested documents.",
  licence: "parlamento-dados-abertos",
  attribution: "Assembleia da República — Dados Abertos",
  topics: ["government"],
  config: { feed: "petitions", legislature: "XVII" },
  policy: parliamentPolicy("petitions", 86_400),
  staleAfterSeconds: 259_200,
  /** Once a day: the XVII petitions file, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
