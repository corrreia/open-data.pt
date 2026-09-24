import { defineFeed } from "#/catalog/define";
import { INE_DEPLOYMENT, INE_NORMALIZER, collectIneIndicator, collectIneIndicatorHistory, transformIneIndicator } from "#/publishers/ine/ine/index";
import { DAILY_STATISTICS } from "#/publishers/ine/ine/feeds";

export const FEED = defineFeed(INE_DEPLOYMENT, {
  slug: "ine-industrial-production-index",
  title: "Industrial production index",
  description: "Calendar and seasonally adjusted industrial production index for the latest month, with 2021 equal to 100.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  config: { indicator: "0011889", lang: "PT" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 7 * 86_400,
  /** Once a day: the indicator's latest period, from INE's indicator API, unless its metadata says nothing changed. */
  fetch: ({ config, validator, library, fetch }) => collectIneIndicator(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods INE lists before the cursor, a bounded set of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectIneIndicatorHistory(config, cursor, library.apiOrigin, fetch),
  /** INE's metadata and data answer, into one series of the indicator's values by period and dimension. */
  transform: { normalizer: INE_NORMALIZER, buffered: (bytes, context) => transformIneIndicator(bytes, context) },
});
