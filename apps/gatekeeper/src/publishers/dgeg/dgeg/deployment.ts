import type { LibraryDeployment } from "#/index";
import { resolveDgegFeed, type DgegContext } from "./collector";
import { DGEG_FEEDS } from "./dgeg";

/** The one origin its API answers on. */
export const DGEG_DEPLOYMENT: LibraryDeployment<{ readonly DGEG_API_ORIGIN: string }, DgegContext> = {
  source: "dgeg",
  name: "DGEG fuel prices",
  vars: { DGEG_API_ORIGIN: "https://precoscombustiveis.dgeg.gov.pt" },
  library: (env) => ({
    kinds: Object.values(DGEG_FEEDS),
    resolve: (config) => resolveDgegFeed(config, env.DGEG_API_ORIGIN, (input, init) => fetch(input, init)),
    context: { apiOrigin: env.DGEG_API_ORIGIN },
  }),
};
