import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { CASCAIS_DAILY_REFERENCE, CASCAIS_HOST } from "#/publishers/cm-cascais/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "cascais-public-schools-feed",
  title: "Cascais public schools",
  description: "Public schools in Cascais with their education level and location.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "society"],
  config: { host: CASCAIS_HOST, dataset: "geocascais-estabelecimentoescolar", resource: "b7b1fef2-960c-4934-a912-92f026ffd000" },
  policy: CASCAIS_DAILY_REFERENCE,
  staleAfterSeconds: 172_800,
  /** Once a day: the geocascais-estabelecimentoescolar resource on Cascais's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Cascais's public schools. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
