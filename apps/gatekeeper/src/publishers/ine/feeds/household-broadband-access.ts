import { defineFeed } from "#/catalog/define";
import { INE_DEPLOYMENT, INE_NORMALIZER, collectIneIndicator, collectIneIndicatorHistory, transformIneIndicator } from "#/publishers/ine/ine/index";
import { ANNUAL_SERIES } from "#/publishers/ine/ine/feeds";

export const FEED = defineFeed(INE_DEPLOYMENT, {
  slug: "ine-household-broadband-access",
  title: "Households with broadband internet access",
  description:
    "Latest annual proportion of private households with at least one resident aged 16 to 74 and a home broadband connection, by NUTS 2024 area. These are aggregate survey statistics, not household-level records.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society", "telecom"],
  config: { indicator: "0013826", lang: "PT" },
  policy: ANNUAL_SERIES,
  staleAfterSeconds: 5_184_000,
  /** Every thirty days: the indicator's latest year, from INE's indicator API, unless its metadata says nothing changed. */
  fetch: ({ config, validator, library, fetch }) => collectIneIndicator(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods INE lists before the cursor, a bounded set of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectIneIndicatorHistory(config, cursor, library.apiOrigin, fetch),
  /** INE's metadata and data answer, into one series of the indicator's values by period and dimension. */
  transform: { normalizer: INE_NORMALIZER, buffered: (bytes, context) => transformIneIndicator(bytes, context) },
});
