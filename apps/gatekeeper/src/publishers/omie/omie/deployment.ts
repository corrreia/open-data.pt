import type { LibraryDeployment } from "#/index";
import { resolveOmieFeed, type OmieContext } from "./collector";
import { OMIE_FEEDS } from "./omie";

/** The one origin its API answers on. */
export const OMIE_DEPLOYMENT: LibraryDeployment<{ readonly OMIE_API_ORIGIN: string }, OmieContext> = {
  source: "omie",
  name: "OMIE electricity market",
  vars: { OMIE_API_ORIGIN: "https://www.omie.es" },
  library: (env) => ({
    kinds: Object.values(OMIE_FEEDS),
    resolve: resolveOmieFeed,
    context: { apiOrigin: env.OMIE_API_ORIGIN },
  }),
};
