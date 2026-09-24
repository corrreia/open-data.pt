import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { AGUEDA_HOST, AGUEDA_MONTHLY } from "#/publishers/cm-agueda/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "agueda-charging-locations-feed",
  title: "Águeda electric-vehicle charging locations",
  description: "Published charging-point location inventory and technical details. This is not live charging availability.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "energy", "mobility"],
  config: { host: AGUEDA_HOST, dataset: "ponto-de-carregamento-de-veiculos-eletricos", resource: "8a0e420f-ebe4-452c-956f-870427811bcd", idField: "id_pontocve" },
  policy: {
    name: "Águeda municipal reference inventory, monthly",
    version: 1,
    collection: AGUEDA_MONTHLY,
  },
  staleAfterSeconds: 90 * 86_400,
  /** Once a month: the ponto-de-carregamento-de-veiculos-eletricos resource on Águeda's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Águeda's electric-vehicle charging locations. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
