import { defineFeed } from "#/catalog/define";
import { INE_DEPLOYMENT, INE_NORMALIZER, collectIneIndicator, collectIneIndicatorHistory, transformIneIndicator } from "#/publishers/ine/ine/index";
import { MONTHLY_SERIES } from "#/publishers/ine/ine/feeds";

export const FEED = defineFeed(INE_DEPLOYMENT, {
  slug: "ine-employment-rate",
  title: "Monthly employment rate by sex",
  description: "Employment rate among residents aged 16 to 74 by sex for February to July 2026.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  config: { indicator: "0007971", lang: "PT", dims: "Dim1=S3A202602,S3A202603,S3A202604,S3A202605,S3A202606,S3A202607" },
  policy: MONTHLY_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the indicator for the periods its dimension filter names, from INE's indicator API, unless its metadata says nothing changed. */
  fetch: ({ config, validator, library, fetch }) => collectIneIndicator(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods INE lists before the cursor, a bounded set of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectIneIndicatorHistory(config, cursor, library.apiOrigin, fetch),
  /** INE's metadata and data answer, into one series of the indicator's values by period and dimension. */
  transform: { normalizer: INE_NORMALIZER, buffered: (bytes, context) => transformIneIndicator(bytes, context) },
});
