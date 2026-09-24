import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { REN_DEPLOYMENT, REN_NORMALIZER, REN_TRANSFORMER, collectRenFeed, collectRenHistory } from "#/publishers/ren/ren/index";
import { REN_GAS_POLICY } from "#/publishers/ren/ren/feeds";

export const FEED = defineFeed(REN_DEPLOYMENT, {
  slug: "ren-gas-network-balance-feed",
  title: "REN natural gas network balance",
  description: "Hourly inputs and outputs for Portugal's high-pressure natural gas network.",
  licence: "ren-datahub",
  attribution: "REN — Redes Energéticas Nacionais",
  topics: ["energy"],
  config: { service: "gas-network-balance" },
  policy: REN_GAS_POLICY,
  staleAfterSeconds: 3600,
  /** Every hour: the Data Hub's gas network balance chart, for yesterday and, once the day is six hours old, today. */
  fetch: ({ config, validator, library, fetch, now }) => collectRenFeed(config, validator, library.apiOrigin, fetch, now()),
  /** Once, walking back: the same chart one older day at a time, until the Data Hub has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => collectRenHistory(config, cursor, library.apiOrigin, fetch),
  /** The chart's answers, into one hourly series per chart line. */
  transform: { normalizer: REN_NORMALIZER, buffered: (bytes, context) => runTransformer(REN_TRANSFORMER, bytes, context) },
});
