import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { DAILY_REFERENCE, PORTO_HOST } from "#/publishers/cm-porto/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "porto-cultural-agenda-feed",
  config: {
    host: PORTO_HOST,
    dataset: "apd-pontos-de-interesse-cultura-e-patrimonio-agenda-cultural",
    resource: "e246f08d-b4d0-4955-ae82-07b516c4c747",
  },
  policy: { ...DAILY_REFERENCE, name: "Porto CKAN daily event changes" },
  staleAfterSeconds: 172_800,
  /** Once a day: Porto's cultural agenda resource on its CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Porto's cultural events. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
