import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { MAFRA_POLICY } from "#/publishers/cm-mafra/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "mafra-fontes-pocos-lavadouros-feed",
  title: "Mafra fountains, wells and wash-houses",
  description: "The municipal fountains, wells and public wash-houses of Mafra: each one's name, street, locality, parish, date and classification.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "culture"],
  config: {
    host: "geomafra.cm-mafra.pt",
    service: "arcgisext/rest/services/Dados_Abertos/DadosAbertos_PatriMuni_Fontes_Pocos_Lavadouros/FeatureServer",
    layer: "1",
  },
  policy: MAFRA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 1 of the DadosAbertos_PatriMuni_Fontes_Pocos_Lavadouros FeatureServer on geomafra.cm-mafra.pt — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
