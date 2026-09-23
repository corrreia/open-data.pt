import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "portuguese-museums-feed",
  config: {
    baseUrl: "https://dados.gov.pt",
    dataset: "museus-em-portugal-websites-e-historico-preservado-no-arquivo-pt",
    distributionId: "5cdbe7e5-38a6-481b-9542-2637fe7ed3cc",
    format: "csv",
    productSlug: "portuguese-museums",
    productTitle: "Museums and museum centres in Portugal",
    productDescription: "Museums and museum centres with municipality, district, website, and archived history links.",
    keyField: "Nome, entidade, organização... (Títle 1)",
    feed: "distribution",
    transformer: "tabular",
  },
  policy: annualPolicy("Portuguese museums annual snapshot", 1 * MIB),
  staleAfterSeconds: 30 * 86_400,
  /** Once a day: the museums CSV Arquivo.pt published on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, read generically, into one record per museum. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
