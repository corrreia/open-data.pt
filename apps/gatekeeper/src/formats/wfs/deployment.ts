import type { LibraryDeployment } from "../../index";
import { wfsCollector } from "./collector";
import { WFS_FEEDS } from "./wfs";

export const WFS_DEPLOYMENT: LibraryDeployment<object> = {
  source: "wfs",
  name: "OGC Web Feature Services",
  vars: {},
  cpuMs: 120_000,
  library: (_env, publishers) => ({
    kinds: Object.values(WFS_FEEDS),
    collector: (config) => wfsCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
