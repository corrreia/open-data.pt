/**
 * Every library the Gatekeeper Worker carries, in directory order. A library
 * under a publication hold (`publication-holds.json`) is not listed, so its
 * code does not ship and its examples are not installed; lifting the hold is
 * one line here. A test holds every directory under `formats/` and `sources/`
 * to being listed here or held, never both.
 */
import type { Library } from "./index";

import { ARCGIS_DEPLOYMENT, ARCGIS_EXAMPLES } from "./formats/arcgis";
import { CKAN_DEPLOYMENT, CKAN_EXAMPLES } from "./formats/ckan";
import { GBFS_DEPLOYMENT, GBFS_EXAMPLES } from "./formats/gbfs";
import { GTFS_DEPLOYMENT, GTFS_EXAMPLES } from "./formats/gtfs";
import { OGC_DEPLOYMENT, OGC_EXAMPLES } from "./formats/ogc";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_EXAMPLES } from "./formats/opendatasoft";
import { UDATA_DEPLOYMENT, UDATA_EXAMPLES } from "./formats/udata";
import { WFS_DEPLOYMENT, WFS_EXAMPLES } from "./formats/wfs";
import { BPSTAT_DEPLOYMENT, BPSTAT_EXAMPLES } from "./sources/bpstat";
import { CARRIS_DEPLOYMENT, CARRIS_EXAMPLES } from "./sources/carris";
import { DGEG_DEPLOYMENT, DGEG_EXAMPLES } from "./sources/dgeg";
import { EUROSTAT_DEPLOYMENT, EUROSTAT_EXAMPLES } from "./sources/eurostat";
import { FIRMS_DEPLOYMENT, FIRMS_EXAMPLES } from "./sources/firms";
import { INE_DEPLOYMENT, INE_EXAMPLES } from "./sources/ine";
import { IPMA_DEPLOYMENT, IPMA_EXAMPLES } from "./sources/ipma";
import { METROLISBOA_DEPLOYMENT, METRO_LISBOA_EXAMPLES } from "./sources/metrolisboa";
import { MYINFO_DEPLOYMENT, MYINFO_EXAMPLES } from "./sources/myinfo";
import { NASA_POWER_DEPLOYMENT, NASA_POWER_EXAMPLES } from "./sources/nasapower";
import { OMIE_DEPLOYMENT, OMIE_EXAMPLES } from "./sources/omie";
import { PARLIAMENT_DEPLOYMENT, PARLIAMENT_EXAMPLES } from "./sources/parliament";
import { REN_DEPLOYMENT, REN_EXAMPLES } from "./sources/ren";
import { USGS_DEPLOYMENT, USGS_EXAMPLES } from "./sources/usgs";

export const LIBRARIES: readonly Library[] = [
  { deployment: ARCGIS_DEPLOYMENT, examples: ARCGIS_EXAMPLES },
  { deployment: CKAN_DEPLOYMENT, examples: CKAN_EXAMPLES },
  { deployment: GBFS_DEPLOYMENT, examples: GBFS_EXAMPLES },
  { deployment: GTFS_DEPLOYMENT, examples: GTFS_EXAMPLES },
  { deployment: OGC_DEPLOYMENT, examples: OGC_EXAMPLES },
  { deployment: OPENDATASOFT_DEPLOYMENT, examples: OPENDATASOFT_EXAMPLES },
  { deployment: UDATA_DEPLOYMENT, examples: UDATA_EXAMPLES },
  { deployment: WFS_DEPLOYMENT, examples: WFS_EXAMPLES },
  { deployment: BPSTAT_DEPLOYMENT, examples: BPSTAT_EXAMPLES },
  { deployment: CARRIS_DEPLOYMENT, examples: CARRIS_EXAMPLES },
  { deployment: DGEG_DEPLOYMENT, examples: DGEG_EXAMPLES },
  { deployment: EUROSTAT_DEPLOYMENT, examples: EUROSTAT_EXAMPLES },
  { deployment: FIRMS_DEPLOYMENT, examples: FIRMS_EXAMPLES },
  { deployment: INE_DEPLOYMENT, examples: INE_EXAMPLES },
  { deployment: IPMA_DEPLOYMENT, examples: IPMA_EXAMPLES },
  { deployment: METROLISBOA_DEPLOYMENT, examples: METRO_LISBOA_EXAMPLES },
  { deployment: MYINFO_DEPLOYMENT, examples: MYINFO_EXAMPLES },
  { deployment: NASA_POWER_DEPLOYMENT, examples: NASA_POWER_EXAMPLES },
  { deployment: OMIE_DEPLOYMENT, examples: OMIE_EXAMPLES },
  { deployment: PARLIAMENT_DEPLOYMENT, examples: PARLIAMENT_EXAMPLES },
  { deployment: REN_DEPLOYMENT, examples: REN_EXAMPLES },
  { deployment: USGS_DEPLOYMENT, examples: USGS_EXAMPLES },
];

/** One listed library by the `source` value its examples carry. */
export function library(source: string): Library {
  const found = LIBRARIES.find((candidate) => candidate.deployment.source === source);
  if (!found) throw new Error(`No library is listed as ${source}`);
  return found;
}
