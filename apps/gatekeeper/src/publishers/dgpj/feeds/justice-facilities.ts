import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "justice-facilities-feed",
  title: "Portuguese justice facilities",
  description: "Courts and other justice facilities with addresses and coordinates, published by the Directorate-General for Justice Policy.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral da Política de Justiça",
  topics: ["society"],
  config: {
    baseUrl: "https://dados.gov.pt",
    dataset: "justica-no-mapa",
    distributionId: "3d951837-9cae-4474-8b5b-e5934b9a93e8",
    format: "csv",
    productSlug: "justice-facilities",
    productTitle: "Portuguese justice facilities",
    productDescription: "Justice facilities with contact details and map coordinates.",
    keyField: "Nome",
    feed: "distribution",
    transformer: "tabular",
  },
  policy: annualPolicy("Justice facilities annual snapshot", 1 * MIB),
  staleAfterSeconds: 30 * 86_400,
  /** Once a day: DGPJ's justice facilities CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, read generically, into one record per facility. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
