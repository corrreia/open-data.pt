import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-activities-xvii-feed",
  title: "Parliament XVII: activities",
  description:
    "Hearings, audiences, debates, visits and events published for the XVII legislature, as separate nonduplicated tables from one document. Source dates are preserved; activity documents and personal submissions are not copied.",
  licence: "parlamento-dados-abertos",
  attribution: "Assembleia da República — Dados Abertos",
  topics: ["government"],
  config: { feed: "activities", legislature: "XVII" },
  policy: parliamentPolicy("activities", 86_400),
  staleAfterSeconds: 259_200,
  /** Once a day: the XVII activities file, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
