import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { LISBON_UNSTATED_POLICY } from "#/publishers/cm-lisboa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "lisbon-urgent-works-feed",
  config: {
    host: "services.arcgis.com",
    service: "1dSrzEWVQn5kHHyK/arcgis/rest/services/DCIEP_OBRAS_25_gdb/FeatureServer",
    layer: "1",
  },
  policy: LISBON_UNSTATED_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 1 of the DCIEP_OBRAS_25_gdb FeatureServer on services.arcgis.com — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
