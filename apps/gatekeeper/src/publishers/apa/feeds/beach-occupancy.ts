import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_HOURLY_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-beach-occupancy-feed",
  title: "Portugal beach occupancy",
  description:
    "How full each of Portugal's 761 bathing beaches is during the bathing season, as APA shows it live: each beach's capacity, its occupancy state and share of the beach in use, when the state was set and until when it holds, and its water quality. Out of season the states are empty. Kept as a history of every change.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment", "society"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/Visualizador/PRAIAS_OCUPACAO/MapServer",
    layer: "0",
  },
  policy: APA_HOURLY_POLICY,
  staleAfterSeconds: 10_800,
  /** Every hour: layer 0 of the PRAIAS_OCUPACAO MapServer on sniambgeoogc.apambiente.pt — its metadata, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
