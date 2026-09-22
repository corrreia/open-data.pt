import type { FeedDefinition } from "../../catalog/define";
import { WFS_MAX_BYTES } from "../../formats/wfs";

/*
 * DGT's GeoServer. WFS is switched off for the server as a whole —
 * `/geoserver/ows` answers "Service WFS is disabled" — but on for individual
 * workspaces, so every path here names its workspace.
 *
 * This is where the islands are. The pygeoapi service the `ogc` library reads
 * carries the mainland alone, and the CAOP feeds there say so; Madeira and the
 * Azores are published only here, in the same columns as the mainland.
 *
 * Two workspaces are deliberately not read. `altimetria` holds 60,084 spot
 * heights and 56,329 contour lines, past the 40,000 features a reference feed
 * may buffer, and the service pages them at about fourteen seconds per five
 * hundred. `CLC` holds 53,776 CORINE polygons, past the same bound.
 */
const GEO2_HOST = "geo2.dgterritorio.gov.pt";

interface Geo2Layer {
  slug: string;
  workspace: string;
  layer: string;
  /** How often the layer is read, in seconds; an edition-based layer weekly, an archive monthly. */
  cadenceSeconds: number;
  /** Raised past the five minutes a small layer needs, where the walk is long. */
  timeoutSeconds?: number;
  numberFields?: string;
  /**
   * The attributes to ask for, where the outlines must be left at the source.
   * Naming any column at all is how the geometry column is left out.
   */
  propertyNames?: string;
  /** Raised past the default only for a layer with tens of thousands of features. */
  maxRecords?: number;
}

export const CAOP_COLUMNS = "area_ha,perimetro_km";
/*
 * The island charter is read as attributes, exactly as the mainland one is, and
 * for the same reason: Porto Santo alone carries 1.3 MB of coastline and islets,
 * past the megabyte the kernel stores a record in, and one Azorean municipality
 * reaches half of it. Naming the columns is what leaves the geometry behind.
 */
export const CAOP_MUNICIPALITY_COLUMNS = "dtmn,municipio,distrito_ilha,nuts1,nuts2,nuts3,nuts3_cod,area_ha,perimetro_km,n_freguesias";
export const CAOP_PARISH_COLUMNS = "dtmnfr,freguesia,municipio,distrito_ilha,nuts1,nuts2,nuts3,nuts3_cod,area_ha,perimetro_km";

/**
 * One layer of DGT's GeoServer. A layer carries its geometry unless a property
 * list says otherwise: the geodetic networks, the summits and the photograph
 * index are points and cost almost nothing, while the administrative charter
 * and the mountain outlines are read as attributes and left where they are.
 */
export function geo2Feed(layer: Geo2Layer): FeedDefinition {
  const config: FeedDefinition["config"] = {
    source: "wfs",
    feed: "reference",
    host: GEO2_HOST,
    path: `/geoserver/${layer.workspace}/wfs`,
    typeName: `${layer.workspace}:${layer.layer}`,
    // None of these layers carries a column that tells one row from the next, so
    // each is keyed by the identity the service gives its features.
    idField: "@id",
    // Stored on PT-TM06: unasked, the service answers in metres, which is an
    // outline nothing can place and a latitude and longitude that come out empty.
    srsName: "EPSG:4326",
  };
  if (layer.numberFields) config.numberFields = layer.numberFields;
  if (layer.propertyNames) config.propertyNames = layer.propertyNames;
  return {
    slug: layer.slug,
    config,
    // Two reads' grace: a layer republished just after a run is not called stale
    // before the next run has had its chance at it.
    staleAfterSeconds: layer.cadenceSeconds * 2,
    policy: {
      name: "DGT GeoServer reference layer",
      version: 1,
      collection: {
        cadenceSeconds: layer.cadenceSeconds,
        timeoutSeconds: layer.timeoutSeconds ?? 300,
        maxBytes: WFS_MAX_BYTES,
        maxOutputBytes: 48 * 1024 * 1024,
        maxRecordBytes: 512 * 1024,
        maxRecords: layer.maxRecords ?? 20_000,
        historyMode: "changes",
      },
    },
  };
}
