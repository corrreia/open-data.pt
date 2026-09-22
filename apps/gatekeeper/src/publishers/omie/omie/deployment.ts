import type { LibraryDeployment } from "../../../index";
import { omieCollector } from "./collector";
import { OMIE_FEEDS } from "./omie";

/** The one origin its API answers on. */
export const OMIE_DEPLOYMENT: LibraryDeployment<{ readonly OMIE_API_ORIGIN: string }> = {
  source: "omie",
  name: "OMIE electricity market",
  vars: { OMIE_API_ORIGIN: "https://www.omie.es" },
  library: (env) => ({
    kinds: Object.values(OMIE_FEEDS),
    collector: (config) => omieCollector({ config, apiOrigin: env.OMIE_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
