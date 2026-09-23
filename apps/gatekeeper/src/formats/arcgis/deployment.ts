import { allowedHosts, type LibraryDeployment } from "#/index";
import { resolveArcgisFeed, type ArcgisContext } from "./collector";
import { ARCGIS_FEEDS } from "./arcgis";

/** Any ArcGIS server a publisher folder's feed names: its hosts are the only ones this library may fetch. */
export const ARCGIS_DEPLOYMENT: LibraryDeployment<object, ArcgisContext> = {
  source: "arcgis",
  name: "ArcGIS feature services",
  vars: {},
  library: (_env, publishers) => {
    const hosts = allowedHosts(publishers.hosts.join(","));
    return {
      kinds: Object.values(ARCGIS_FEEDS),
      resolve: (config) => resolveArcgisFeed(config, hosts),
      context: { hosts },
    };
  },
};
