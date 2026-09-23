import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-professional-profiles-xvii-feed",
  title: "Parliament XVII: professional profiles",
  description:
    "Published professional qualifications, roles and works associated with the XVII legislature's biographical register. Excludes birth dates, sex, private contacts and identity-only profiles; not restricted to currently active MPs.",
  config: { feed: "careers", legislature: "XVII" },
  policy: parliamentPolicy("careers", 604_800),
  staleAfterSeconds: 1_814_400,
  /** Once a week: the XVII biographical register, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
