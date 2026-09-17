import type { LibraryDeployment } from "../../index";
import { ogcCollector } from "./collector";
import { OGC_FEEDS } from "./ogc";

/** Hosts its feeds may be read from. */
export const OGC_DEPLOYMENT: LibraryDeployment<{ readonly OGC_ALLOWED_HOSTS: string }> = {
  source: "ogc",
  name: "OGC API Features services",
  vars: { OGC_ALLOWED_HOSTS: "ogcapi.dgterritorio.gov.pt,ambiente.azores.gov.pt" },
  library: (env) => ({
    kinds: Object.values(OGC_FEEDS),
    collector: (config) => ogcCollector({ config, hosts: env.OGC_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
