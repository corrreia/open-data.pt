import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { DAILY_REFERENCE, PORTO_HOST } from "#/publishers/cm-porto/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "porto-municipal-trees-feed",
  title: "Porto municipal trees",
  description: "Identified municipal trees with species, age range, and source geometry.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "environment"],
  config: {
    host: PORTO_HOST,
    dataset: "identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto",
    resource: "ed573cc6-3c01-462d-b136-f6a4d059e9a6",
  },
  // About 72,000 trees: the 6.5 MB CSV normalizes to more than the 16 MiB default output cap.
  policy: {
    ...DAILY_REFERENCE,
    name: "Porto CKAN daily large reference snapshot",
    collection: { ...DAILY_REFERENCE.collection, timeoutSeconds: 180, maxOutputBytes: 64 * 1024 * 1024 },
  },
  staleAfterSeconds: 604_800,
  /** Once a day: Porto's tree inventory resource on its CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Porto's municipal trees. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
