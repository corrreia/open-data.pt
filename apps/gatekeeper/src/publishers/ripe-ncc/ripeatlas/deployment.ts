import type { LibraryDeployment } from "#/index";
import { ripeatlasCollector } from "./collector";
import { RIPEATLAS_FEEDS } from "./ripeatlas";

/** The one origin its API answers on; this library never creates a measurement, so it needs no key. */
export const RIPEATLAS_DEPLOYMENT: LibraryDeployment<{ readonly RIPEATLAS_API_ORIGIN: string }> = {
  source: "ripeatlas",
  name: "RIPE Atlas",
  vars: { RIPEATLAS_API_ORIGIN: "https://atlas.ripe.net" },
  library: (env) => ({
    kinds: Object.values(RIPEATLAS_FEEDS),
    collector: (config) => ripeatlasCollector({ config, apiOrigin: env.RIPEATLAS_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
