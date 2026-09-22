import type { FeedDefinition } from "../../catalog/define";
import { WFS_MAX_BYTES } from "../../formats/wfs";

/*
 * Oeiras publishes a `dados_abertos` workspace of 240 feature types on its own
 * GeoServer. Almost none of those layers carries an identifier column — an
 * inventory of road works names a street, a state and a contractor, and nothing
 * that tells one row from the next — so they are keyed by the identity the
 * service gives each feature, which this GeoServer derives from the key of the
 * table behind the layer and returns in that order.
 */
const OEIRAS_HOST = "oeirasinterativa.oeiras.pt";
const OEIRAS_PATH = "/gis/services/dados_abertos/wfs";

interface OeirasLayer {
  slug: string;
  layer: string;
  /** The layer's own key, where it has one; otherwise the service's feature identity. */
  idField?: string;
  numberFields?: string;
  dateFields?: string;
  dateOnlyFields?: string;
}

export function oeirasFeed(layer: OeirasLayer): FeedDefinition {
  const config: FeedDefinition["config"] = {
    source: "wfs",
    feed: "reference",
    host: OEIRAS_HOST,
    path: OEIRAS_PATH,
    typeName: `dados_abertos:${layer.layer}`,
    idField: layer.idField ?? "@id",
    // The workspace is stored on PT-TM06, so an unqualified read answers in metres:
    // geometry nothing can place and a latitude and longitude that come out empty.
    srsName: "EPSG:4326",
  };
  if (layer.numberFields) config.numberFields = layer.numberFields;
  if (layer.dateFields) config.dateFields = layer.dateFields;
  if (layer.dateOnlyFields) config.dateOnlyFields = layer.dateOnlyFields;
  return {
    slug: layer.slug,
    config,
    staleAfterSeconds: 172_800,
    policy: {
      name: "Oeiras daily reference layer",
      version: 1,
      collection: {
        cadenceSeconds: 86_400,
        timeoutSeconds: 180,
        maxBytes: WFS_MAX_BYTES,
        maxOutputBytes: 48 * 1024 * 1024,
        maxRecordBytes: 256 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
    },
  };
}
