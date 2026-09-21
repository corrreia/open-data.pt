import type { LibraryDeployment } from "../../index";
import { stacCollector } from "./collector";
import { STAC_FEEDS } from "./stac";

export const STAC_DEPLOYMENT: LibraryDeployment<{ readonly STAC_ALLOWED_HOSTS: string }> = {
  source: "stac",
  name: "SpatioTemporal Asset Catalogs",
  vars: { STAC_ALLOWED_HOSTS: "cdd.dgterritorio.gov.pt" },
  library: (env) => ({
    kinds: Object.values(STAC_FEEDS),
    collector: (config) => stacCollector({ config, hosts: env.STAC_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
