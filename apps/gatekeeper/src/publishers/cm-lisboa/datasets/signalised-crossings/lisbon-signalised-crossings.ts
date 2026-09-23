import { defineFeed } from "#/catalog/define";
import { arcgisReferencePolicy } from "#/formats/arcgis/feeds";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "lisbon-signalised-crossings-feed",
  config: {
    host: "services.arcgis.com",
    service: "1dSrzEWVQn5kHHyK/arcgis/rest/services/CruzamentosSemaforizados/FeatureServer",
    layer: "0",
  },
  policy: arcgisReferencePolicy("ArcGIS daily reference layer, dedicated"),
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the CruzamentosSemaforizados FeatureServer on services.arcgis.com — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
