import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIT_DEPLOYMENT, SNIT_NORMALIZER, SNIT_TRANSFORMER, collectSnitFeed } from "#/publishers/dgt/snit/index";
import { MEBIBYTE, SNIT_WEEKLY_POLICY, WEEK } from "#/publishers/dgt/snit/feeds";

export const FEED = defineFeed(SNIT_DEPLOYMENT, {
  slug: "snit-pdm-feed",
  title: "Municipal master plans",
  description:
    "The plan every municipality must have, classifying all of its land and setting the rules that bind every other plan beneath it. Every Plano Diretor Municipal (PDM) the national register holds as being in force — 278 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["cities", "government"],
  config: { feed: "instruments", type: "pdm" },
  policy: { ...SNIT_WEEKLY_POLICY, collection: { ...SNIT_WEEKLY_POLICY.collection, timeoutSeconds: 600, maxBytes: 16 * MEBIBYTE } },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the register's list of municipalities, then every Plano Diretor Municipal (PDM) in force across them, with the acts behind each. */
  fetch: ({ config, validator, library, fetch }) => collectSnitFeed(config, validator, library.apiOrigin, fetch),
  /** The register's answer into two products: the instruments and the acts of the Diário da República behind them. */
  transform: { normalizer: SNIT_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIT_TRANSFORMER, bytes, context) },
});
