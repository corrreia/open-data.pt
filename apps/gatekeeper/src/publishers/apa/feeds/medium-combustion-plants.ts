import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-medium-combustion-plants-feed",
  title: "Portugal medium combustion plants",
  description:
    "Every medium combustion plant (1 to 50 MW thermal) registered with APA and the regional coordination commissions: its establishment and operator, address, activity code, equipment, fuel, rated thermal input, size class, whether it is new or existing, and when it started.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment", "energy"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/Visualizador/InstCombM/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the InstCombM MapServer on sniambgeoogc.apambiente.pt — its metadata, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
