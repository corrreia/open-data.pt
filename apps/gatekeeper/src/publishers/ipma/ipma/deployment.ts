import type { LibraryDeployment } from "../../../index";
import { ipmaCollector } from "./collector";
import { IPMA_FEEDS } from "./ipma";

/** The one origin its API answers on. */
export const IPMA_DEPLOYMENT: LibraryDeployment<{ readonly IPMA_API_ORIGIN: string }> = {
  source: "ipma",
  name: "IPMA weather and sea",
  vars: { IPMA_API_ORIGIN: "https://api.ipma.pt" },
  library: (env) => ({
    kinds: Object.values(IPMA_FEEDS),
    collector: (config) => ipmaCollector({ config, apiOrigin: env.IPMA_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
