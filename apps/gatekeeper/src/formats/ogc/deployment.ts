import type { LibraryDeployment } from "../../index";
import { ogcCollector } from "./collector";
import { OGC_FEEDS } from "./ogc";

export const OGC_DEPLOYMENT: LibraryDeployment<object> = {
  source: "ogc",
  name: "OGC API Features services",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(OGC_FEEDS),
    collector: (config) => ogcCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
