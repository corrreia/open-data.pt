import { defineFeed } from "#/catalog/define";
import { INE_DEPLOYMENT, INE_NORMALIZER, collectIneIndicator, collectIneIndicatorHistory, transformIneIndicator } from "#/publishers/ine/ine/index";
import { MONTHLY_SERIES } from "#/publishers/ine/ine/feeds";

export const FEED = defineFeed(INE_DEPLOYMENT, {
  slug: "ine-live-births",
  title: "Monthly live births by area and sex",
  description: "Live births by the mother's NUTS 2024 area of residence and sex for January to June 2026.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society"],
  config: { indicator: "0012094", lang: "PT", dims: "Dim1=S3A202601,S3A202602,S3A202603,S3A202604,S3A202605,S3A202606" },
  policy: MONTHLY_SERIES,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the indicator for the periods its dimension filter names, from INE's indicator API, unless its metadata says nothing changed. */
  fetch: ({ config, validator, library, fetch }) => collectIneIndicator(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods INE lists before the cursor, a bounded set of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectIneIndicatorHistory(config, cursor, library.apiOrigin, fetch),
  /** INE's metadata and data answer, into one series of the indicator's values by period and dimension. */
  transform: { normalizer: INE_NORMALIZER, buffered: (bytes, context) => transformIneIndicator(bytes, context) },
});
