import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { LISBON_POLICY } from "#/publishers/cm-lisboa/arcgis";

// The permits layer grows every month: 14,737 parcel outlines in September 2026, about 16 MB of GeoJSON and 19 MB
// normalized, past the 16 MB the kernel allows an output that states no cap of its own.
const LISBON_PERMITS_POLICY = {
  ...LISBON_POLICY,
  name: "ArcGIS daily large reference layer",
  collection: {
    ...LISBON_POLICY.collection,
    timeoutSeconds: 180,
    maxBytes: 32 * 1024 * 1024,
    maxOutputBytes: 48 * 1024 * 1024,
  },
};

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "lisbon-building-permits-feed",
  title: "Lisbon building and demolition permits",
  description: "Permits issued for building and demolition works in Lisbon, with dates, addresses, and parcel outlines.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  config: {
    host: "services.arcgis.com",
    service: "1dSrzEWVQn5kHHyK/arcgis/rest/services/AlvarasObras/FeatureServer",
    layer: "0",
  },
  policy: LISBON_PERMITS_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the AlvarasObras FeatureServer on services.arcgis.com — its metadata, then, when it has moved, every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
