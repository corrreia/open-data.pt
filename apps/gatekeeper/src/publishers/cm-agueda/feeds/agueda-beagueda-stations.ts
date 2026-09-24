import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { AGUEDA_HOST, AGUEDA_MONTHLY } from "#/publishers/cm-agueda/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "agueda-beagueda-stations-feed",
  title: "beÁgueda bicycle station locations",
  description: "Reference locations and dock capacities of beÁgueda bicycle stations, not live bicycle or dock availability.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "mobility"],
  config: { host: AGUEDA_HOST, dataset: "estacoes-beagueda", resource: "c6da7509-f4b1-4a3c-a39b-5af5e4908288", idField: "id" },
  policy: {
    name: "Águeda municipal reference inventory, monthly",
    version: 1,
    collection: AGUEDA_MONTHLY,
  },
  staleAfterSeconds: 90 * 86_400,
  /** Once a month: the estacoes-beagueda resource on Águeda's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of beÁgueda bicycle station locations. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
