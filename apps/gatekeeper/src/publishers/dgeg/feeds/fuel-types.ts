import { defineFeed } from "#/catalog/define";
import { DGEG_DEPLOYMENT, DGEG_NORMALIZER, DGEG_TRANSFORMER, collectDgegFeed } from "#/publishers/dgeg/dgeg/index";
import { FUEL_TYPES_MAX_BYTES } from "#/publishers/dgeg/dgeg/dgeg";

export const FEED = defineFeed(DGEG_DEPLOYMENT, {
  slug: "dgeg-fuel-types",
  title: "DGEG fuel types",
  description: "Daily reference list of fuel types and source units used by the price service.",
  licence: "dgeg-precos-terms",
  attribution: "Direção-Geral de Energia e Geologia",
  topics: ["energy"],
  config: { feed: "fuel-types" },
  policy: {
    name: "DGEG fuel reference data",
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 20,
      maxBytes: FUEL_TYPES_MAX_BYTES,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 172_800,
  /** Once a day: the list of fuel types and their units that DGEG's price service names fuels by. */
  fetch: ({ config, validator, library, fetch }) => collectDgegFeed(config, validator, library.apiOrigin, fetch),
  /** DGEG's fuel list, into a table of fuel types. */
  transform: { normalizer: DGEG_NORMALIZER, buffered: (bytes, context) => DGEG_TRANSFORMER.transform(bytes, context) },
});
