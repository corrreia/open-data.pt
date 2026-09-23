import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { CASCAIS_DAILY_REFERENCE, CASCAIS_HOST } from "#/publishers/cm-cascais/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "cascais-rental-kiosks-feed",
  config: { host: CASCAIS_HOST, dataset: "geocascais-mobilidadesuave", resource: "1fc3ad4f-2b6b-4779-ba9f-5c90b6260012" },
  policy: CASCAIS_DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: the geocascais-mobilidadesuave resource on Cascais's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Cascais's soft-mobility rental kiosks. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
