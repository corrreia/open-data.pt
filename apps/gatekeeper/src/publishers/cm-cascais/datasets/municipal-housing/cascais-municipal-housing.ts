import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { CASCAIS_DAILY_REFERENCE, CASCAIS_HOST } from "#/publishers/cm-cascais/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "cascais-municipal-housing-feed",
  config: { host: CASCAIS_HOST, dataset: "geocascais-habitacaomunicipal", resource: "35e169ef-c209-4f44-971a-aba56990cbf4" },
  policy: CASCAIS_DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: the geocascais-habitacaomunicipal resource on Cascais's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Cascais's municipal housing. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
