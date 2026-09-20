import type { LibraryDeployment } from "../../index";
import { gbfsCollector } from "./collector";
import { GBFS_FEEDS } from "./gbfs";

/** Hosts its feeds may be read from. */
export const GBFS_DEPLOYMENT: LibraryDeployment<{ readonly GBFS_ALLOWED_HOSTS: string }> = {
  source: "gbfs",
  name: "GBFS bike-share feeds",
  vars: { GBFS_ALLOWED_HOSTS: "mds.bird.co,gbfs.primelayer.pt,gbfs.nextbike.net" },
  library: (env) => ({
    kinds: Object.values(GBFS_FEEDS),
    collector: (config) => gbfsCollector({ config, hosts: env.GBFS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
