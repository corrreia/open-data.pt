import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { MAFRA_POLICY } from "#/publishers/cm-mafra/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "mafra-postos-carregamento-feed",
  title: "Mafra electric-vehicle charging points",
  description:
    "Charging points in Mafra with their operator, the kind of charge and number of chargers, the form of operation, and the licence and contract periods each runs under.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["energy", "mobility"],
  config: {
    host: "geomafra.cm-mafra.pt",
    service: "arcgisext/rest/services/Dados_Abertos/DadosAbertos_Postos_Carregamento_Eletrico/FeatureServer",
    layer: "0",
  },
  policy: MAFRA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the DadosAbertos_Postos_Carregamento_Eletrico FeatureServer on geomafra.cm-mafra.pt — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
