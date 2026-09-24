import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIT_DEPLOYMENT, SNIT_NORMALIZER, SNIT_TRANSFORMER, collectSnitFeed } from "#/publishers/dgt/snit/index";
import { SNIT_WEEKLY_POLICY, WEEK } from "#/publishers/dgt/snit/feeds";

export const FEED = defineFeed(SNIT_DEPLOYMENT, {
  slug: "snit-medidas-preventivas-feed",
  title: "Preventive measures",
  description:
    "Temporary restrictions that freeze what may be done to a piece of land while a plan for it is being drawn. Every Medidas Preventivas (MP) the national register holds as being in force — 3 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["cities", "government"],
  config: { feed: "instruments", type: "medidas-preventivas" },
  policy: SNIT_WEEKLY_POLICY,
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the register's list of municipalities, then every Medidas Preventivas (MP) in force across them, with the acts behind each. */
  fetch: ({ config, validator, library, fetch }) => collectSnitFeed(config, validator, library.apiOrigin, fetch),
  /** The register's answer into two products: the instruments and the acts of the Diário da República behind them. */
  transform: { normalizer: SNIT_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIT_TRANSFORMER, bytes, context) },
});
