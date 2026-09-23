import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIT_DEPLOYMENT, SNIT_NORMALIZER, SNIT_TRANSFORMER, collectSnitFeed } from "#/publishers/dgt/snit/index";
import { SNIT_WEEKLY_POLICY, WEEK } from "#/publishers/dgt/snit/feeds";

export const FEED = defineFeed(SNIT_DEPLOYMENT, {
  slug: "snit-poaap-feed",
  config: { feed: "instruments", type: "poaap" },
  policy: { ...SNIT_WEEKLY_POLICY, collection: { ...SNIT_WEEKLY_POLICY.collection, timeoutSeconds: 180 } },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the register's list of municipalities, then every Plano de Ordenamento de Albufeira de Águas Públicas (POAAP) in force across them, with the acts behind each. */
  fetch: ({ config, validator, library, fetch }) => collectSnitFeed(config, validator, library.apiOrigin, fetch),
  /** The register's answer into two products: the instruments and the acts of the Diário da República behind them. */
  transform: { normalizer: SNIT_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIT_TRANSFORMER, bytes, context) },
});
