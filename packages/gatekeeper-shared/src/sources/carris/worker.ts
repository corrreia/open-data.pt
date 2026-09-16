import type { LibraryDeployment } from "../../index";
import { carrisCollector } from "./collector";
import { CARRIS_FEEDS } from "./carris";

/** The one origin its API answers on. */
export const CARRIS_DEPLOYMENT: LibraryDeployment<{ readonly CARRIS_API_ORIGIN: string }> = {
  source: "carris",
  vars: { CARRIS_API_ORIGIN: "https://api.carrismetropolitana.pt" },
  library: (env) => ({
    kinds: Object.values(CARRIS_FEEDS),
    collector: (config) => carrisCollector({ config, apiOrigin: env.CARRIS_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
