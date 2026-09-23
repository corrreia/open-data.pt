import type { LibraryDeployment } from "#/index";
import { resolveGbfsFeed, type GbfsContext } from "./collector";
import { GBFS_FEEDS } from "./gbfs";

export const GBFS_DEPLOYMENT: LibraryDeployment<object, GbfsContext> = {
  source: "gbfs",
  name: "GBFS bike-share feeds",
  vars: {},
  library: (_env, publishers) => {
    const hosts = publishers.hosts.join(",");
    return {
      kinds: Object.values(GBFS_FEEDS),
      resolve: (config) => resolveGbfsFeed(config, hosts),
      context: { hosts },
    };
  },
};
