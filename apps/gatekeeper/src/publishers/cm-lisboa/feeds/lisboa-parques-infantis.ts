import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { LISBON_POLICY } from "#/publishers/cm-lisboa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "lisboa-parques-infantis-feed",
  title: "Lisboa playgrounds",
  description: "Locations and management details for playgrounds in Lisboa.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  config: {
    host: "services.arcgis.com",
    service: "1dSrzEWVQn5kHHyK/arcgis/rest/services/POIArLivre/FeatureServer",
    layer: "2",
  },
  policy: LISBON_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 2 of the POIArLivre FeatureServer on services.arcgis.com — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
