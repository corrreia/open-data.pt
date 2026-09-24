import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { AGUEDA_HOST, AGUEDA_MONTHLY } from "#/publishers/cm-agueda/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "agueda-waste-operators-feed",
  title: "Águeda waste-management operators",
  description: "Reference locations and published details of waste-management establishments.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  config: { host: AGUEDA_HOST, dataset: "b2d1563d-683f-4dff-a472-a68789c9df74", resource: "4a836cd0-eed9-4ecd-b9fc-ebeee1323aae", idField: "id_ogr" },
  policy: {
    name: "Águeda municipal reference inventory, monthly",
    // Reconfigured once: the feed's initial origin requests exhausted retries.
    version: 2,
    collection: AGUEDA_MONTHLY,
  },
  staleAfterSeconds: 90 * 86_400,
  /** Once a month: the b2d1563d-683f-4dff-a472-a68789c9df74 resource on Águeda's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Águeda's waste-management operators. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
