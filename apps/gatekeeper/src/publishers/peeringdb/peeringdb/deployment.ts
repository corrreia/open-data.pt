import type { LibraryDeployment } from "#/index";
import { resolvePeeringdbFeed, type PeeringdbContext } from "./collector";
import { PEERINGDB_FEEDS } from "./peeringdb";

/** The one origin its API answers on. */
export const PEERINGDB_DEPLOYMENT: LibraryDeployment<{ readonly PEERINGDB_API_ORIGIN: string }, PeeringdbContext> = {
  source: "peeringdb",
  name: "PeeringDB",
  vars: { PEERINGDB_API_ORIGIN: "https://www.peeringdb.com" },
  library: (env) => ({
    kinds: Object.values(PEERINGDB_FEEDS),
    resolve: resolvePeeringdbFeed,
    context: { apiOrigin: env.PEERINGDB_API_ORIGIN },
  }),
};
