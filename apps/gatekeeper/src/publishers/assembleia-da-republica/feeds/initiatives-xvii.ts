import { defineFeed } from "#/catalog/define";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_NORMALIZER, collectParliamentFeed, transformParliament } from "#/publishers/assembleia-da-republica/parliament/index";
import { parliamentPolicy } from "#/publishers/assembleia-da-republica/parliament/feeds";

export const FEED = defineFeed(PARLIAMENT_DEPLOYMENT, {
  slug: "parliament-initiatives-xvii-feed",
  title: "Parliament XVII: initiatives and votes",
  description:
    "Every bill, draft resolution and other initiative of the XVII legislature, each step of its procedure, and every plenary and committee vote on it with each parliamentary group's position. Parliament records votes by group: named members appear only where they voted apart from their group, and head counts only where Parliament gives them. Unanimous votes and some procedural committee votes carry no per-group detail, so their position lists are empty.",
  licence: "parlamento-dados-abertos",
  attribution: "Assembleia da República — Dados Abertos",
  topics: ["government"],
  config: { feed: "initiatives", legislature: "XVII" },
  // A 93 MB source: 35 s to download and read live, 19,491 rows and 10 MB of output measured for XVII.
  policy: parliamentPolicy("initiatives", 86_400, { timeoutSeconds: 600, maxOutputBytes: 32 * 1024 * 1024 }),
  staleAfterSeconds: 259_200,
  /** Once a day: the XVII initiatives file, found through Parliament's public directory, and not parsed when its staged digest is unchanged. */
  fetch: ({ config, state, library, fetch }) => collectParliamentFeed(config, state, fetch, library.staging),
  /** The document, streamed one element at a time into Parliament's public-record tables. */
  transform: { normalizer: PARLIAMENT_NORMALIZER, streaming: (body, context) => transformParliament(body, context) },
});
