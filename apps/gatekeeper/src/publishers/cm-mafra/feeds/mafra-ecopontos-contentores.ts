import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { MAFRA_POLICY } from "#/publishers/cm-mafra/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "mafra-ecopontos-contentores-feed",
  title: "Mafra recycling points",
  description:
    "Recycling points in Mafra, each naming the containers standing there for paper, packaging, glass, batteries, refuse, bio-waste, oil and textiles, with its street, locality and parish.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "environment"],
  config: {
    host: "geomafra.cm-mafra.pt",
    service: "arcgisext/rest/services/Dados_Abertos/DadosAbertos_Amb_Ecopontos_Contentores/FeatureServer",
    // Layer 2 of that same service holds the 8,635 containers themselves, one record each with
    // capacity and state of conservation, and is the richer half of the pair. It is a table
    // rather than a feature layer, and this library reads layers: it requires a geometry type
    // and a table declares none. Read it once tables are supported, not by pretending it has one.
    layer: "1",
  },
  policy: MAFRA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 1 of the DadosAbertos_Amb_Ecopontos_Contentores FeatureServer on geomafra.cm-mafra.pt — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
