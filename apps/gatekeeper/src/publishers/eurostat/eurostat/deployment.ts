import type { LibraryDeployment } from "#/index";
import { resolveEurostatFeed, type EurostatContext } from "./collector";
import { EUROSTAT_FEEDS } from "./eurostat";

/** The one origin its API answers on. */
export const EUROSTAT_DEPLOYMENT: LibraryDeployment<{ readonly EUROSTAT_API_ORIGIN: string }, EurostatContext> = {
  source: "eurostat",
  name: "Eurostat",
  vars: { EUROSTAT_API_ORIGIN: "https://ec.europa.eu" },
  library: (env) => ({
    kinds: Object.values(EUROSTAT_FEEDS),
    resolve: resolveEurostatFeed,
    context: { apiOrigin: env.EUROSTAT_API_ORIGIN },
  }),
};
