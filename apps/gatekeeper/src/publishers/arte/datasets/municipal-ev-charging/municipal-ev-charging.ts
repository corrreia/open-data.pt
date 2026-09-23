import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "municipal-ev-charging-feed",
  config: {
    baseUrl: "https://dados.gov.pt",
    dataset: "enti-indicador-disponibilizacao-e-localizacao-de-postos-de-carregamento-de-veiculos-eletricos",
    distributionId: "309bfd1f-bdb6-442e-9fdd-b9ce41424d40",
    format: "csv",
    productSlug: "municipal-ev-charging-availability",
    productTitle: "Municipal availability of electric-vehicle charging",
    productDescription: "Municipality-level availability of public electric-vehicle charging locations in 2023.",
    eventTimeField: "ano",
    feed: "distribution",
    transformer: "tabular",
  },
  policy: annualPolicy("Municipal EV charging annual snapshot", 1 * MIB),
  staleAfterSeconds: 30 * 86_400,
  /** Once a day: ARTE's EV charging indicator CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, read generically, into one record per municipality. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
