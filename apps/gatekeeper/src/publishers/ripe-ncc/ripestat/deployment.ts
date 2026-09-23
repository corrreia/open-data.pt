import type { LibraryDeployment } from "#/index";
import { resolveRipestatFeed, type RipestatContext } from "./collector";
import { RIPESTAT_FEEDS } from "./ripestat";

/** The one origin its API answers on. */
export const RIPESTAT_DEPLOYMENT: LibraryDeployment<{ readonly RIPESTAT_API_ORIGIN: string }, RipestatContext> = {
  source: "ripestat",
  name: "RIPEstat",
  vars: { RIPESTAT_API_ORIGIN: "https://stat.ripe.net" },
  library: (env) => ({
    kinds: Object.values(RIPESTAT_FEEDS),
    resolve: resolveRipestatFeed,
    context: { apiOrigin: env.RIPESTAT_API_ORIGIN },
  }),
};
