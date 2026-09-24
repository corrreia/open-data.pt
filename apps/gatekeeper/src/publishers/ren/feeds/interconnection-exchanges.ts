import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { REN_DEPLOYMENT, REN_NORMALIZER, REN_TRANSFORMER, collectRenFeed, collectRenHistory } from "#/publishers/ren/ren/index";
import { REN_ELECTRICITY_POLICY } from "#/publishers/ren/ren/feeds";

export const FEED = defineFeed(REN_DEPLOYMENT, {
  slug: "ren-interconnection-exchanges-feed",
  title: "REN electricity interconnection exchanges",
  description: "Quarter-hour electricity imports and exports across Portugal's interconnections.",
  licence: "ren-datahub",
  attribution: "REN — Redes Energéticas Nacionais",
  topics: ["energy"],
  config: { service: "interconnection-exchanges" },
  policy: REN_ELECTRICITY_POLICY,
  staleAfterSeconds: 3600,
  /** Every half hour: the Data Hub's interconnection import balance chart, for yesterday and, once the day is six hours old, today. */
  fetch: ({ config, validator, library, fetch, now }) => collectRenFeed(config, validator, library.apiOrigin, fetch, now()),
  /** Once, walking back: the same chart one older day at a time, until the Data Hub has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => collectRenHistory(config, cursor, library.apiOrigin, fetch),
  /** The chart's answers, into one quarter-hour series per chart line. */
  transform: { normalizer: REN_NORMALIZER, buffered: (bytes, context) => runTransformer(REN_TRANSFORMER, bytes, context) },
});
