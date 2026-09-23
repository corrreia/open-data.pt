import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "public-libraries-2024-feed",
  config: {
    baseUrl: "https://dados.gov.pt",
    dataset: "dados-estatisticos-da-rede-nacional-de-bibliotecas-publicas-2024",
    distributionId: "00f3876f-dfe4-47a1-9f53-e06de3e275a2",
    format: "csv",
    productSlug: "public-library-statistics-2024",
    productTitle: "Portuguese public library statistics for 2024",
    productDescription: "One record per reporting library, with typed population, collection, use, staffing, and service measures.",
    headerRow: "3",
    feed: "distribution",
    transformer: "tabular",
  },
  policy: annualPolicy("Public libraries annual snapshot", 1 * MIB),
  staleAfterSeconds: 30 * 86_400,
  /** Once a day: DGLAB's 2024 public library statistics CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, read generically from its third row, into one record per library. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
