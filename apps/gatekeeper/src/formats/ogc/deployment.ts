import { allowedHosts, type LibraryDeployment } from "#/index";
import { resolveOgcFeed, type OgcContext } from "./collector";
import { OGC_FEEDS } from "./ogc";

/**
 * Neither service this library reads publishes anything but its current
 * release, so its feeds keep no history to walk back through. What they may
 * fetch is exactly the hosts the publisher folders' feeds name.
 */
export const OGC_DEPLOYMENT: LibraryDeployment<object, OgcContext> = {
  source: "ogc",
  name: "OGC API Features services",
  vars: {},
  library: (_env, publishers) => {
    const hosts = allowedHosts(publishers.hosts.join(","));
    return {
      kinds: Object.values(OGC_FEEDS),
      resolve: (config) => resolveOgcFeed(config, hosts),
      context: { hosts },
    };
  },
};
