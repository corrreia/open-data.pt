import type { FeedDefinition } from "../../catalog/define";
import { arcgisReferencePolicy } from "../../formats/arcgis/feeds";

const APA_HOST = "sniambgeoogc.apambiente.pt";
const APA_SERVICE_ROOT = "getogc/rest/services/SNIAmb";
const APA_POLICY = arcgisReferencePolicy("APA daily reference layer");

/** One layer of an APA SNIAmb service. Where several feeds read one dataset, each says what it is within it. */
interface ApaLayer {
  slug: string;
  title?: string;
  description?: string;
  service: string;
  /** The layer within the map service, where it is not the first. */
  layer?: string;
}

export function apaFeed(layer: ApaLayer): FeedDefinition {
  const feed: FeedDefinition = {
    slug: layer.slug,
    config: {
      source: "arcgis",
      host: APA_HOST,
      service: `${APA_SERVICE_ROOT}/${layer.service}/MapServer`,
      layer: layer.layer ?? "0",
    },
    policy: APA_POLICY,
    staleAfterSeconds: 172_800,
  };
  if (layer.title) feed.title = layer.title;
  if (layer.description) feed.description = layer.description;
  return feed;
}
