import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIT_DEPLOYMENT, SNIT_NORMALIZER, SNIT_TRANSFORMER, collectSnitFeed } from "#/publishers/dgt/snit/index";
import { MEBIBYTE, SNIT_WEEKLY_POLICY, WEEK } from "#/publishers/dgt/snit/feeds";

export const FEED = defineFeed(SNIT_DEPLOYMENT, {
  slug: "snit-pp-feed",
  title: "Detail plans",
  description:
    "Plans that fix, street by street and plot by plot, what may be built in one part of a municipality. Every Plano de Pormenor (PP) the national register holds as being in force — 687 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["cities", "government"],
  config: { feed: "instruments", type: "pp" },
  policy: { ...SNIT_WEEKLY_POLICY, collection: { ...SNIT_WEEKLY_POLICY.collection, timeoutSeconds: 600, maxBytes: 8 * MEBIBYTE } },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the register's list of municipalities, then every Plano de Pormenor (PP) in force across them, with the acts behind each. */
  fetch: ({ config, validator, library, fetch }) => collectSnitFeed(config, validator, library.apiOrigin, fetch),
  /** The register's answer into two products: the instruments and the acts of the Diário da República behind them. */
  transform: { normalizer: SNIT_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIT_TRANSFORMER, bytes, context) },
});
