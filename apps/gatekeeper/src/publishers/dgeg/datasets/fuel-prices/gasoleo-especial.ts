import { defineFeed } from "#/catalog/define";
import { DGEG_DEPLOYMENT, DGEG_NORMALIZER, DGEG_TRANSFORMER, collectDgegFeed } from "#/publishers/dgeg/dgeg/index";
import { HOURLY_PRICES } from "#/publishers/dgeg/dgeg/feeds";

export const FEED = defineFeed(DGEG_DEPLOYMENT, {
  slug: "dgeg-gasoleo-especial",
  title: "Gasóleo especial prices in mainland Portugal",
  description: "Current station prices and hourly municipal medians for premium diesel (gasóleo especial).",
  config: { feed: "fuel-prices", fuelTypeId: "2105" },
  policy: HOURLY_PRICES,
  staleAfterSeconds: 7_200,
  /** Every hour: every mainland station's current gasóleo especial price, from DGEG's price search, district by district. */
  fetch: ({ config, validator, library, fetch }) => collectDgegFeed(config, validator, library.apiOrigin, fetch),
  /** DGEG's station prices, into a station price table and municipal median series. */
  transform: { normalizer: DGEG_NORMALIZER, buffered: (bytes, context) => DGEG_TRANSFORMER.transform(bytes, context) },
});
