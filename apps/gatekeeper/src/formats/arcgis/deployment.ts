import type { LibraryDeployment } from "../../index";
import { arcgisCollector } from "./collector";
import { ARCGIS_FEEDS } from "./arcgis";

export const ARCGIS_DEPLOYMENT: LibraryDeployment<object> = {
  source: "arcgis",
  name: "ArcGIS feature services",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(ARCGIS_FEEDS),
    collector: (config) => arcgisCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
