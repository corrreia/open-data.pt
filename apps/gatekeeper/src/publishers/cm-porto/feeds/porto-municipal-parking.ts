import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { DAILY_REFERENCE, PORTO_HOST } from "#/publishers/cm-porto/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "porto-municipal-parking-feed",
  title: "Porto municipal car parks",
  description: "Municipal car parks, capacities, management, and opening hours.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "mobility"],
  config: {
    host: PORTO_HOST,
    dataset: "parques-de-estacionamento-municipais",
    resource: "e9898000-f437-42d3-8c5b-22c5594052b2",
  },
  policy: DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: Porto's municipal car parks resource on its CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Porto's municipal car parks. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
