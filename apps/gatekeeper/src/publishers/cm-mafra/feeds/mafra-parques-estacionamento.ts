import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { MAFRA_POLICY } from "#/publishers/cm-mafra/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "mafra-parques-estacionamento-feed",
  title: "Mafra parking areas",
  description: "Parking areas in Mafra with their designation, the number of spaces each holds, whether those spaces are charged for, the address and the parish.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "mobility"],
  config: {
    host: "geomafra.cm-mafra.pt",
    service: "arcgisext/rest/services/Dados_Abertos/DadosAbertos_Transito_Parques_Estacionamento/FeatureServer",
    layer: "0",
  },
  policy: MAFRA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the DadosAbertos_Transito_Parques_Estacionamento FeatureServer on geomafra.cm-mafra.pt — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
