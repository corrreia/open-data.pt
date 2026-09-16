import type { LibraryDeployment } from "../../index";
import { ineCollector } from "./collector";
import { INE_FEEDS } from "./ine";

/** The one origin its API answers on. */
export const INE_DEPLOYMENT: LibraryDeployment<{ readonly INE_API_ORIGIN: string }> = {
  source: "ine",
  vars: { INE_API_ORIGIN: "https://www.ine.pt" },
  library: (env) => ({
    kinds: Object.values(INE_FEEDS),
    collector: (config) => ineCollector({ config, apiOrigin: env.INE_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
