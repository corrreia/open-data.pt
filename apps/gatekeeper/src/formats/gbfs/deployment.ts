import type { LibraryDeployment } from "#/index";
import { gbfsCollector } from "./collector";
import { GBFS_FEEDS } from "./gbfs";

export const GBFS_DEPLOYMENT: LibraryDeployment<object> = {
  source: "gbfs",
  name: "GBFS bike-share feeds",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(GBFS_FEEDS),
    collector: (config) => gbfsCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
