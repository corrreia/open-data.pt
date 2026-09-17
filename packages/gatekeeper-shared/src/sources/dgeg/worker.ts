import type { LibraryDeployment } from "../../index";
import { dgegCollector } from "./collector";
import { DGEG_FEEDS } from "./dgeg";

/** The one origin its API answers on. */
export const DGEG_DEPLOYMENT: LibraryDeployment<{ readonly DGEG_API_ORIGIN: string }> = {
  source: "dgeg",
  name: "DGEG fuel prices",
  vars: { DGEG_API_ORIGIN: "https://precoscombustiveis.dgeg.gov.pt" },
  library: (env) => ({
    kinds: Object.values(DGEG_FEEDS),
    collector: (config) => dgegCollector({ config, apiOrigin: env.DGEG_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
