import type { LibraryDeployment } from "../../../index";
import { ripestatCollector } from "./collector";
import { RIPESTAT_FEEDS } from "./ripestat";

/** The one origin its API answers on. */
export const RIPESTAT_DEPLOYMENT: LibraryDeployment<{ readonly RIPESTAT_API_ORIGIN: string }> = {
  source: "ripestat",
  name: "RIPEstat",
  vars: { RIPESTAT_API_ORIGIN: "https://stat.ripe.net" },
  library: (env) => ({
    kinds: Object.values(RIPESTAT_FEEDS),
    collector: (config) => ripestatCollector({ config, apiOrigin: env.RIPESTAT_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
