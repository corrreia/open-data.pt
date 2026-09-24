import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIT_DEPLOYMENT, SNIT_NORMALIZER, SNIT_TRANSFORMER, collectSnitFeed } from "#/publishers/dgt/snit/index";
import { SNIT_WEEKLY_POLICY, WEEK } from "#/publishers/dgt/snit/feeds";

export const FEED = defineFeed(SNIT_DEPLOYMENT, {
  slug: "snit-pu-feed",
  title: "Urbanisation plans",
  description:
    "Plans that set the layout and use of an urban area between the master plan above them and the detail plans below. Every Plano de Urbanização (PU) the national register holds as being in force — 171 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["cities", "government"],
  config: { feed: "instruments", type: "pu" },
  policy: { ...SNIT_WEEKLY_POLICY, collection: { ...SNIT_WEEKLY_POLICY.collection, timeoutSeconds: 300 } },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the register's list of municipalities, then every Plano de Urbanização (PU) in force across them, with the acts behind each. */
  fetch: ({ config, validator, library, fetch }) => collectSnitFeed(config, validator, library.apiOrigin, fetch),
  /** The register's answer into two products: the instruments and the acts of the Diário da República behind them. */
  transform: { normalizer: SNIT_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIT_TRANSFORMER, bytes, context) },
});
