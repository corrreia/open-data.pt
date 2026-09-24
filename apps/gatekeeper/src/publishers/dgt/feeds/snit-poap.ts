import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIT_DEPLOYMENT, SNIT_NORMALIZER, SNIT_TRANSFORMER, collectSnitFeed } from "#/publishers/dgt/snit/index";
import { SNIT_WEEKLY_POLICY, WEEK } from "#/publishers/dgt/snit/feeds";

export const FEED = defineFeed(SNIT_DEPLOYMENT, {
  slug: "snit-poap-feed",
  title: "Protected area plans",
  description:
    "The older plan tier for protected areas, still in force where no programme has replaced it. Every Plano de Ordenamento de Área Protegida (POAP) the national register holds as being in force — 25 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["environment", "government"],
  config: { feed: "instruments", type: "poap" },
  policy: SNIT_WEEKLY_POLICY,
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the register's list of municipalities, then every Plano de Ordenamento de Área Protegida (POAP) in force across them, with the acts behind each. */
  fetch: ({ config, validator, library, fetch }) => collectSnitFeed(config, validator, library.apiOrigin, fetch),
  /** The register's answer into two products: the instruments and the acts of the Diário da República behind them. */
  transform: { normalizer: SNIT_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIT_TRANSFORMER, bytes, context) },
});
