import type { LibraryDeployment } from "../../../index";
import { peeringdbCollector } from "./collector";
import { PEERINGDB_FEEDS } from "./peeringdb";

/** The one origin its API answers on. */
export const PEERINGDB_DEPLOYMENT: LibraryDeployment<{ readonly PEERINGDB_API_ORIGIN: string }> = {
  source: "peeringdb",
  name: "PeeringDB",
  vars: { PEERINGDB_API_ORIGIN: "https://www.peeringdb.com" },
  library: (env) => ({
    kinds: Object.values(PEERINGDB_FEEDS),
    collector: (config) => peeringdbCollector({ config, apiOrigin: env.PEERINGDB_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
