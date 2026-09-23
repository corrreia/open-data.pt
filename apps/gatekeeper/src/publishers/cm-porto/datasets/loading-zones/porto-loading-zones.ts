import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { DAILY_REFERENCE, PORTO_HOST } from "#/publishers/cm-porto/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "porto-loading-zones-feed",
  config: {
    host: PORTO_HOST,
    dataset: "cargas-e-descargas",
    resource: "51dc9778-0735-428e-9b26-d08fc06eb5bf",
  },
  policy: DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: Porto's loading zones resource on its CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Porto's loading and unloading bays. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
