import type { FeedDefinition } from "../../catalog/define";
import { arcgisReferencePolicy } from "../../formats/arcgis/feeds";

const LISBON_HOST = "services.arcgis.com";
const LISBON_SERVICE_ROOT = "1dSrzEWVQn5kHHyK/arcgis/rest/services";

export const LISBON_POLICY = arcgisReferencePolicy("ArcGIS daily reference layer");
export const LISBON_UNSTATED_POLICY = arcgisReferencePolicy("ArcGIS daily reference layer, terms unstated");

/** One layer of a Lisboa service. Where several feeds read one dataset, each says what it is within it. */
interface LisbonLayer {
  slug: string;
  /** What this feed is within its dataset, where the dataset holds more than one. */
  title?: string;
  description?: string;
  service: string;
  layer: string;
  /** The terms the service resolves to decide which policy it is served under; the plain one otherwise. */
  policy?: FeedDefinition["policy"];
}

export function lisbonFeed(layer: LisbonLayer): FeedDefinition {
  const feed: FeedDefinition = {
    slug: layer.slug,
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/${layer.service}/FeatureServer`,
      layer: layer.layer,
    },
    policy: layer.policy ?? LISBON_POLICY,
    staleAfterSeconds: 172_800,
  };
  if (layer.title) feed.title = layer.title;
  if (layer.description) feed.description = layer.description;
  return feed;
}
