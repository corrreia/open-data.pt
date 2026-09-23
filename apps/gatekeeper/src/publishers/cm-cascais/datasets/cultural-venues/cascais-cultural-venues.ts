import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { CASCAIS_DAILY_REFERENCE, CASCAIS_HOST } from "#/publishers/cm-cascais/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "cascais-cultural-venues-feed",
  config: { host: CASCAIS_HOST, dataset: "geocascais-equipamentocultural", resource: "9b899d53-8e7f-4d61-bac1-86449853a87b" },
  policy: CASCAIS_DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: the geocascais-equipamentocultural resource on Cascais's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Cascais's cultural venues. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
