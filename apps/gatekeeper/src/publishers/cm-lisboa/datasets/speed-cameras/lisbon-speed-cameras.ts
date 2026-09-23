import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { LISBON_POLICY } from "#/publishers/cm-lisboa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "lisbon-speed-cameras-feed",
  title: "Lisbon speed cameras",
  description: "Locations of fixed speed cameras on Lisbon roads.",
  config: {
    host: "services.arcgis.com",
    service: "1dSrzEWVQn5kHHyK/arcgis/rest/services/MOB_RadaresPaineis/FeatureServer",
    layer: "0",
  },
  policy: LISBON_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the MOB_RadaresPaineis FeatureServer on services.arcgis.com — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
