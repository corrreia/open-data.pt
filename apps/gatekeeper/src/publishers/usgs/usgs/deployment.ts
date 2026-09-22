import type { LibraryDeployment } from "../../../index";
import { usgsCollector } from "./collector";
import { USGS_API_ORIGIN, USGS_FEEDS } from "./usgs";

export const USGS_DEPLOYMENT: LibraryDeployment<{ readonly USGS_API_ORIGIN: string }> = {
  source: "usgs",
  name: "USGS earthquake catalog",
  vars: { USGS_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(USGS_FEEDS),
    collector: (config) => usgsCollector({ config, apiOrigin: env.USGS_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
