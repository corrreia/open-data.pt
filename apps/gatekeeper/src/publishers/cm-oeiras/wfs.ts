import type { FeedPolicy } from "#/catalog/define";
import { WFS_MAX_BYTES } from "#/formats/wfs/index";

/*
 * Oeiras publishes a `dados_abertos` workspace of 240 feature types on its own
 * GeoServer, at oeirasinterativa.oeiras.pt/gis/services/dados_abertos/wfs.
 * Almost none of those layers carries an identifier column — an inventory of
 * road works names a street, a state and a contractor, and nothing that tells
 * one row from the next — so they are keyed by the identity the service gives
 * each feature (`@id`), which this GeoServer derives from the key of the table
 * behind the layer and returns in that order.
 *
 * The workspace is stored on PT-TM06, so an unqualified read answers in metres:
 * geometry nothing can place and a latitude and longitude that come out empty.
 * Every feed asks for EPSG:4326.
 */
export const OEIRAS_POLICY: FeedPolicy = {
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
};
