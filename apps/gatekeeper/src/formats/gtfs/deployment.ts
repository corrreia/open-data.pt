import type { LibraryDeployment } from "#/index";
import { resolveGtfsFeed, type GtfsContext } from "./collector";
import { GTFS_FEEDS } from "./gtfs";

export const GTFS_DEPLOYMENT: LibraryDeployment<object, GtfsContext> = {
  source: "gtfs",
  name: "GTFS transit feeds",
  // One GTFS archive is tens of megabytes of CSV, parsed in a single invocation.
  cpuMs: 120_000,
  vars: {},
  library: (_env, publishers) => {
    const hosts = publishers.hosts.join(",");
    return {
      kinds: Object.values(GTFS_FEEDS),
      resolve: (config) => resolveGtfsFeed(config, hosts),
      context: { hosts },
    };
  },
};
