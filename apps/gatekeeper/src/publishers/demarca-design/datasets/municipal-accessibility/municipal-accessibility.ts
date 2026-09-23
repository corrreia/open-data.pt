import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, collectUdataFeed } from "#/formats/udata/index";
import { MIB, annualPolicy } from "#/formats/udata/feeds";
import { MUNICIPAL_ACCESSIBILITY_TRANSFORMER } from "#/publishers/demarca-design/municipal-accessibility";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "municipal-accessibility-feed",
  config: {
    baseUrl: "https://dados.gov.pt",
    dataset: "acessibilidade-digital-nos-municipios-portugueses-1-a-edicao-2026",
    distributionId: "c03ae2c2-9c33-4c6f-9d1a-bb813088d6e6",
    format: "csv",
    productSlug: "municipal-accessibility",
    productTitle: "Municipal digital accessibility",
    keyField: "entidade",
    feed: "distribution",
    transformer: "municipal-accessibility",
  },
  policy: annualPolicy("Municipal accessibility annual snapshot", 2 * MIB),
  staleAfterSeconds: 30 * 86_400,
  /** Once a day: DEMARCA's accessibility survey CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, with DEMARCA's own translator, into one record per municipal website. */
  transform: {
    normalizer: { id: MUNICIPAL_ACCESSIBILITY_TRANSFORMER.id, version: MUNICIPAL_ACCESSIBILITY_TRANSFORMER.version },
    streaming: (body, context) => MUNICIPAL_ACCESSIBILITY_TRANSFORMER.transform(body, context),
  },
});
