/**
 * Every library the Gatekeeper Worker carries: every format under `formats/`,
 * and every publisher's own library under `publishers/<publisher>/`, which a
 * test holds this list to. A library is code; which feeds it reads is the
 * publisher folders' word, and a publisher held for permission installs
 * nothing, so a library that reads only held publishers ships and polls nobody.
 */
import type { Library } from "./index";

import { ARCGIS_DEPLOYMENT } from "./formats/arcgis";
import { CKAN_DEPLOYMENT } from "./formats/ckan";
import { GBFS_DEPLOYMENT } from "./formats/gbfs";
import { GTFS_DEPLOYMENT } from "./formats/gtfs";
import { NGSI_DEPLOYMENT } from "./formats/ngsi";
import { OGC_DEPLOYMENT } from "./formats/ogc";
import { OPENDATASOFT_DEPLOYMENT } from "./formats/opendatasoft";
import { UDATA_DEPLOYMENT } from "./formats/udata";
import { WFS_DEPLOYMENT } from "./formats/wfs";
import { ANEPC_DEPLOYMENT } from "./publishers/anepc/anepc";
import { BPSTAT_DEPLOYMENT } from "./publishers/banco-de-portugal/bpstat";
import { CARRIS_DEPLOYMENT } from "./publishers/carris-metropolitana/carris";
import { DGEG_DEPLOYMENT } from "./publishers/dgeg/dgeg";
import { EUROSTAT_DEPLOYMENT } from "./publishers/eurostat/eurostat";
import { FIRMS_DEPLOYMENT } from "./publishers/nasa-firms/firms";
import { INE_DEPLOYMENT } from "./publishers/ine/ine";
import { INFOAGUA_DEPLOYMENT } from "./publishers/apa/infoagua";
import { IODA_DEPLOYMENT } from "./publishers/ioda/ioda";
import { IPMA_DEPLOYMENT } from "./publishers/ipma/ipma";
import { METROLISBOA_DEPLOYMENT } from "./publishers/metropolitano-de-lisboa/metrolisboa";
import { MYINFO_DEPLOYMENT } from "./formats/myinfo";
import { NASA_POWER_DEPLOYMENT } from "./publishers/nasa-power/nasapower";
import { OMIE_DEPLOYMENT } from "./publishers/omie/omie";
import { PARLIAMENT_DEPLOYMENT } from "./publishers/assembleia-da-republica/parliament";
import { PEERINGDB_DEPLOYMENT } from "./publishers/peeringdb/peeringdb";
import { REN_DEPLOYMENT } from "./publishers/ren/ren";
import { RIPESTAT_DEPLOYMENT } from "./publishers/ripe-ncc/ripestat";
import { SNIRH_DEPLOYMENT } from "./publishers/apa/snirh";
import { SNIT_DEPLOYMENT } from "./publishers/dgt/snit";
import { USGS_DEPLOYMENT } from "./publishers/usgs/usgs";

export const LIBRARIES: readonly Library[] = [
  { deployment: ARCGIS_DEPLOYMENT },
  { deployment: CKAN_DEPLOYMENT },
  { deployment: GBFS_DEPLOYMENT },
  { deployment: GTFS_DEPLOYMENT },
  { deployment: NGSI_DEPLOYMENT },
  { deployment: OGC_DEPLOYMENT },
  { deployment: OPENDATASOFT_DEPLOYMENT },
  { deployment: UDATA_DEPLOYMENT },
  { deployment: WFS_DEPLOYMENT },
  { deployment: ANEPC_DEPLOYMENT },
  { deployment: BPSTAT_DEPLOYMENT },
  { deployment: CARRIS_DEPLOYMENT },
  { deployment: DGEG_DEPLOYMENT },
  { deployment: EUROSTAT_DEPLOYMENT },
  { deployment: FIRMS_DEPLOYMENT },
  { deployment: INE_DEPLOYMENT },
  { deployment: INFOAGUA_DEPLOYMENT },
  { deployment: IODA_DEPLOYMENT },
  { deployment: IPMA_DEPLOYMENT },
  { deployment: METROLISBOA_DEPLOYMENT },
  { deployment: MYINFO_DEPLOYMENT },
  { deployment: NASA_POWER_DEPLOYMENT },
  { deployment: OMIE_DEPLOYMENT },
  { deployment: PARLIAMENT_DEPLOYMENT },
  { deployment: PEERINGDB_DEPLOYMENT },
  { deployment: REN_DEPLOYMENT },
  { deployment: RIPESTAT_DEPLOYMENT },
  { deployment: SNIRH_DEPLOYMENT },
  { deployment: SNIT_DEPLOYMENT },
  { deployment: USGS_DEPLOYMENT },
];

/** One listed library by the `source` value its examples carry. */
export function library(source: string): Library {
  const found = LIBRARIES.find((candidate) => candidate.deployment.source === source);
  if (!found) throw new Error(`No library is listed as ${source}`);
  return found;
}
