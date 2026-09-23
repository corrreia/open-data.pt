import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, collectUdataFeed } from "#/formats/udata/index";
import { annualPolicy } from "#/formats/udata/feeds";
import { MUNICIPAL_WASTE_TRANSFORMER } from "#/publishers/cm-cadaval/municipal-waste";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "cadaval-municipal-waste-feed",
  config: {
    baseUrl: "https://dados.gov.pt",
    dataset: "producao-de-residuos-municipio-cadaval",
    distributionId: "33ebfc7e-7951-4170-9d76-d2ad5e8498a6",
    format: "csv",
    productSlug: "cadaval-municipal-waste",
    productTitle: "Cadaval municipal waste in 2024",
    feed: "distribution",
    transformer: "municipal-waste",
  },
  policy: annualPolicy("Cadaval waste annual snapshot", 256 * 1024),
  staleAfterSeconds: 30 * 86_400,
  /** Once a day: Cadaval's 2024 waste CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, with Cadaval's own translator, into monthly tonnes by material and route. */
  transform: {
    normalizer: { id: MUNICIPAL_WASTE_TRANSFORMER.id, version: MUNICIPAL_WASTE_TRANSFORMER.version },
    streaming: (body, context) => MUNICIPAL_WASTE_TRANSFORMER.transform(body, context),
  },
});
