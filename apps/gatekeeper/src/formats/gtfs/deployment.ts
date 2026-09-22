import type { LibraryDeployment } from "#/index";
import { gtfsCollector } from "./collector";
import { GTFS_FEEDS } from "./gtfs";

export const GTFS_DEPLOYMENT: LibraryDeployment<object> = {
  source: "gtfs",
  name: "GTFS transit feeds",
  // One GTFS archive is tens of megabytes of CSV, parsed in a single invocation.
  cpuMs: 120_000,
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(GTFS_FEEDS),
    collector: (config) => gtfsCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
