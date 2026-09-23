import type { FeedPolicy } from "#/catalog/define";
import { WFS_MAX_BYTES } from "#/formats/wfs/index";

/*
 * DGT's GeoServer, at geo2.dgterritorio.gov.pt. WFS is switched off for the
 * server as a whole — `/geoserver/ows` answers "Service WFS is disabled" — but
 * on for individual workspaces, so every path here names its workspace.
 *
 * This is where the islands are. The pygeoapi service the `ogc` library reads
 * carries the mainland alone, and the CAOP feeds there say so; Madeira and the
 * Azores are published only here, in the same columns as the mainland.
 *
 * Two workspaces are deliberately not read. `altimetria` holds 60,084 spot
 * heights and 56,329 contour lines, past the 40,000 features a reference feed
 * may buffer, and the service pages them at about fourteen seconds per five
 * hundred. `CLC` holds 53,776 CORINE polygons, past the same bound.
 *
 * None of these layers carries a column that tells one row from the next, so
 * each is keyed by the identity the service gives its features (`@id`). They
 * are stored on PT-TM06: unasked, the service answers in metres, which is an
 * outline nothing can place and a latitude and longitude that come out empty,
 * so every feed asks for EPSG:4326. A layer carries its geometry unless a
 * property list says otherwise: the geodetic networks, the summits and the
 * photograph index are points and cost almost nothing, while the
 * administrative charter and the mountain outlines are read as attributes and
 * left where they are. Every feed is called stale after two reads' grace: a
 * layer republished just after a run is not called stale before the next run
 * has had its chance at it.
 */

export const CAOP_COLUMNS = "area_ha,perimetro_km";
/*
 * The island charter is read as attributes, exactly as the mainland one is, and
 * for the same reason: Porto Santo alone carries 1.3 MB of coastline and islets,
 * past the megabyte the kernel stores a record in, and one Azorean municipality
 * reaches half of it. Naming the columns is what leaves the geometry behind.
 */
export const CAOP_MUNICIPALITY_COLUMNS = "dtmn,municipio,distrito_ilha,nuts1,nuts2,nuts3,nuts3_cod,area_ha,perimetro_km,n_freguesias";
export const CAOP_PARISH_COLUMNS = "dtmnfr,freguesia,municipio,distrito_ilha,nuts1,nuts2,nuts3,nuts3_cod,area_ha,perimetro_km";

/** An edition-based layer, read once a week. */
export const DGT_WEEKLY_POLICY: FeedPolicy = {
  name: "DGT GeoServer reference layer",
  version: 1,
  collection: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 300,
    maxBytes: WFS_MAX_BYTES,
    maxOutputBytes: 48 * 1024 * 1024,
    maxRecordBytes: 512 * 1024,
    maxRecords: 20_000,
    historyMode: "changes",
  },
};

/** An archive or a gazetteer, read once a month. */
export const DGT_MONTHLY_POLICY: FeedPolicy = {
  ...DGT_WEEKLY_POLICY,
  collection: { ...DGT_WEEKLY_POLICY.collection, cadenceSeconds: 2_592_000 },
};
