import type { DatasetDefinition } from "../../../catalog/define";
import { LISBON_POLICY, lisbonFeed } from "../arcgis";

// The permits layer is about 12,000 parcel outlines, roughly 13 MB of GeoJSON.
const LISBON_PERMITS_POLICY = {
  ...LISBON_POLICY,
  name: "ArcGIS daily large reference layer",
  collection: {
    ...LISBON_POLICY.collection,
    timeoutSeconds: 180,
    maxBytes: 24 * 1024 * 1024,
  },
};

export const DATASET: DatasetDefinition = {
  title: "Lisbon building and demolition permits",
  description: "Permits issued for building and demolition works in Lisbon, with dates, addresses, and parcel outlines.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-building-permits-feed", service: "AlvarasObras", layer: "0", policy: LISBON_PERMITS_POLICY })],
};
