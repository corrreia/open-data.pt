import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { AGUEDA_HOST, AGUEDA_MONTHLY } from "#/publishers/cm-agueda/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "agueda-waste-bins-feed",
  config: { host: AGUEDA_HOST, dataset: "contentores-rsu", resource: "5ec1ab1d-998b-41f5-b35d-860d63ec869c", idField: "id", crs: "EPSG:3763" },
  policy: {
    name: "Águeda municipal reference inventory, monthly",
    version: 1,
    collection: AGUEDA_MONTHLY,
  },
  staleAfterSeconds: 90 * 86_400,
  /** Once a month: the contentores-rsu resource on Águeda's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Águeda's municipal waste-bin locations. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
