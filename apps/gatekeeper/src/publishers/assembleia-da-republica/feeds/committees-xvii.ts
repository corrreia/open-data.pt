import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-committees-xvii-feed",
  title: "Parliament XVII: committees, plenary sittings and attendance",
  description:
    "Committee reference, membership histories and meetings, plus every plenary sitting and each member's attendance at it with the absence reason Parliament records (for example illness, family assistance or political work). Other parliamentary bodies are outside this scope. Membership histories are not claims that every listed member currently holds the role.",
  licence: "parlamento-dados-abertos",
  attribution: "Assembleia da República — Dados Abertos",
  topics: ["government"],
  config: { feed: "committees", legislature: "XVII" },
  // 8 MB of output in the first year; attendance grows with every sitting.
  policy: parliamentPolicy("committees", 86_400, { timeoutSeconds: 300, maxOutputBytes: 48 * 1024 * 1024 }),
  staleAfterSeconds: 259_200,
  /** Once a day: the XVII committees and attendance file, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
