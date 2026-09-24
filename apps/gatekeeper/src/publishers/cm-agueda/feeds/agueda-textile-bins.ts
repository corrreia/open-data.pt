import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { AGUEDA_HOST, AGUEDA_MONTHLY } from "#/publishers/cm-agueda/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "agueda-textile-bins-feed",
  title: "Águeda textile collection-bin locations",
  description: "Textile recycling container location inventory, not live capacity or fullness.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  config: { host: AGUEDA_HOST, dataset: "f2f9d71f-ffab-4678-b4a1-6a2709879020", resource: "df073fc9-441e-4385-b50e-0290881a5729", idField: "id", crs: "EPSG:3763" },
  policy: {
    name: "Águeda municipal reference inventory, monthly",
    // Reconfigured once: the feed's initial origin requests exhausted retries.
    version: 2,
    collection: AGUEDA_MONTHLY,
  },
  staleAfterSeconds: 90 * 86_400,
  /** Once a month: the f2f9d71f-ffab-4678-b4a1-6a2709879020 resource on Águeda's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Águeda's textile collection-bin locations. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
