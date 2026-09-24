import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { CASCAIS_DAILY_REFERENCE, CASCAIS_HOST } from "#/publishers/cm-cascais/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "cascais-tsunami-meeting-points-feed",
  title: "Cascais tsunami meeting points",
  description: "Evacuation meeting points to use in case of a tsunami warning in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment", "society"],
  config: { host: CASCAIS_HOST, dataset: "geocascais-pontosencontrotsunami", resource: "f6c7b517-7663-4f7c-bcd9-2db8cfab5036" },
  policy: CASCAIS_DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: the geocascais-pontosencontrotsunami resource on Cascais's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Cascais's tsunami meeting points. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
