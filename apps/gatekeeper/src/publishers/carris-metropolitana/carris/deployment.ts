import type { LibraryDeployment } from "#/index";
import { resolveCarrisFeed, type CarrisContext } from "./collector";
import { CARRIS_FEEDS } from "./carris";

/** The one origin its API answers on. */
export const CARRIS_DEPLOYMENT: LibraryDeployment<{ readonly CARRIS_API_ORIGIN: string }, CarrisContext> = {
  source: "carris",
  name: "Carris Metropolitana",
  vars: { CARRIS_API_ORIGIN: "https://api.carrismetropolitana.pt" },
  library: (env) => ({
    kinds: Object.values(CARRIS_FEEDS),
    resolve: resolveCarrisFeed,
    context: { apiOrigin: env.CARRIS_API_ORIGIN },
  }),
};
