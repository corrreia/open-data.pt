/**
 * Every library the Gatekeeper Worker carries, in directory order: every
 * directory under `formats/` and `sources/`, which a test holds this list to.
 * What a library installs is another question: a publisher held for permission
 * (`enabled: false` in `PUBLISHERS`) installs nothing, so a library that reads
 * only held publishers ships without polling anybody.
 */
import type { Library } from "./index";

import { ARCGIS_DEPLOYMENT, ARCGIS_EXAMPLES } from "./formats/arcgis";
import { CKAN_DEPLOYMENT, CKAN_EXAMPLES } from "./formats/ckan";
import { GBFS_DEPLOYMENT, GBFS_EXAMPLES } from "./formats/gbfs";
import { GTFS_DEPLOYMENT, GTFS_EXAMPLES } from "./formats/gtfs";
import { NGSI_DEPLOYMENT, NGSI_EXAMPLES } from "./formats/ngsi";
import { OGC_DEPLOYMENT, OGC_EXAMPLES } from "./formats/ogc";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_EXAMPLES } from "./formats/opendatasoft";
import { UDATA_DEPLOYMENT, UDATA_EXAMPLES } from "./formats/udata";
import { WFS_DEPLOYMENT, WFS_EXAMPLES } from "./formats/wfs";
import { ANEPC_DEPLOYMENT, ANEPC_EXAMPLES } from "./sources/anepc";
import { BPSTAT_DEPLOYMENT, BPSTAT_EXAMPLES } from "./sources/bpstat";
import { CARRIS_DEPLOYMENT, CARRIS_EXAMPLES } from "./sources/carris";
import { DGEG_DEPLOYMENT, DGEG_EXAMPLES } from "./sources/dgeg";
import { EUROSTAT_DEPLOYMENT, EUROSTAT_EXAMPLES } from "./sources/eurostat";
import { FIRMS_DEPLOYMENT, FIRMS_EXAMPLES } from "./sources/firms";
import { INE_DEPLOYMENT, INE_EXAMPLES } from "./sources/ine";
import { INFOAGUA_DEPLOYMENT, INFOAGUA_EXAMPLES } from "./sources/infoagua";
import { IODA_DEPLOYMENT, IODA_EXAMPLES } from "./sources/ioda";
import { IPMA_DEPLOYMENT, IPMA_EXAMPLES } from "./sources/ipma";
import { METROLISBOA_DEPLOYMENT, METRO_LISBOA_EXAMPLES } from "./sources/metrolisboa";
import { MYINFO_DEPLOYMENT, MYINFO_EXAMPLES } from "./sources/myinfo";
import { NASA_POWER_DEPLOYMENT, NASA_POWER_EXAMPLES } from "./sources/nasapower";
import { OMIE_DEPLOYMENT, OMIE_EXAMPLES } from "./sources/omie";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_EXAMPLES } from "./sources/parliament";
import { PEERINGDB_DEPLOYMENT, PEERINGDB_EXAMPLES } from "./sources/peeringdb";
import { REN_DEPLOYMENT, REN_EXAMPLES } from "./sources/ren";
import { RIPEATLAS_DEPLOYMENT, RIPEATLAS_EXAMPLES } from "./sources/ripeatlas";
import { RIPESTAT_DEPLOYMENT, RIPESTAT_EXAMPLES } from "./sources/ripestat";
import { SNIRH_DEPLOYMENT, SNIRH_EXAMPLES } from "./sources/snirh";
import { SNIT_DEPLOYMENT, SNIT_EXAMPLES } from "./sources/snit";
import { USGS_DEPLOYMENT, USGS_EXAMPLES } from "./sources/usgs";

export const LIBRARIES: readonly Library[] = [
  { deployment: ARCGIS_DEPLOYMENT, examples: ARCGIS_EXAMPLES },
  { deployment: CKAN_DEPLOYMENT, examples: CKAN_EXAMPLES },
  { deployment: GBFS_DEPLOYMENT, examples: GBFS_EXAMPLES },
  { deployment: GTFS_DEPLOYMENT, examples: GTFS_EXAMPLES },
  { deployment: NGSI_DEPLOYMENT, examples: NGSI_EXAMPLES },
  { deployment: OGC_DEPLOYMENT, examples: OGC_EXAMPLES },
  { deployment: OPENDATASOFT_DEPLOYMENT, examples: OPENDATASOFT_EXAMPLES },
  { deployment: UDATA_DEPLOYMENT, examples: UDATA_EXAMPLES },
  { deployment: WFS_DEPLOYMENT, examples: WFS_EXAMPLES },
  { deployment: ANEPC_DEPLOYMENT, examples: ANEPC_EXAMPLES },
  { deployment: BPSTAT_DEPLOYMENT, examples: BPSTAT_EXAMPLES },
  { deployment: CARRIS_DEPLOYMENT, examples: CARRIS_EXAMPLES },
  { deployment: DGEG_DEPLOYMENT, examples: DGEG_EXAMPLES },
  { deployment: EUROSTAT_DEPLOYMENT, examples: EUROSTAT_EXAMPLES },
  { deployment: FIRMS_DEPLOYMENT, examples: FIRMS_EXAMPLES },
  { deployment: INE_DEPLOYMENT, examples: INE_EXAMPLES },
  { deployment: INFOAGUA_DEPLOYMENT, examples: INFOAGUA_EXAMPLES },
  { deployment: IODA_DEPLOYMENT, examples: IODA_EXAMPLES },
  { deployment: IPMA_DEPLOYMENT, examples: IPMA_EXAMPLES },
  { deployment: METROLISBOA_DEPLOYMENT, examples: METRO_LISBOA_EXAMPLES },
  { deployment: MYINFO_DEPLOYMENT, examples: MYINFO_EXAMPLES },
  { deployment: NASA_POWER_DEPLOYMENT, examples: NASA_POWER_EXAMPLES },
  { deployment: OMIE_DEPLOYMENT, examples: OMIE_EXAMPLES },
  { deployment: PARLIAMENT_DEPLOYMENT, examples: PARLIAMENT_EXAMPLES },
  { deployment: PEERINGDB_DEPLOYMENT, examples: PEERINGDB_EXAMPLES },
  { deployment: REN_DEPLOYMENT, examples: REN_EXAMPLES },
  { deployment: RIPEATLAS_DEPLOYMENT, examples: RIPEATLAS_EXAMPLES },
  { deployment: RIPESTAT_DEPLOYMENT, examples: RIPESTAT_EXAMPLES },
  { deployment: SNIRH_DEPLOYMENT, examples: SNIRH_EXAMPLES },
  { deployment: SNIT_DEPLOYMENT, examples: SNIT_EXAMPLES },
  { deployment: USGS_DEPLOYMENT, examples: USGS_EXAMPLES },
];

/** One listed library by the `source` value its examples carry. */
export function library(source: string): Library {
  const found = LIBRARIES.find((candidate) => candidate.deployment.source === source);
  if (!found) throw new Error(`No library is listed as ${source}`);
  return found;
}
