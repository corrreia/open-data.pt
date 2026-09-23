import type { LibraryDeployment } from "#/index";
import { resolveAnepcFeed, type AnepcContext } from "./collector";
import { ANEPC_API_ORIGIN, ANEPC_FEEDS } from "./anepc";

export const ANEPC_DEPLOYMENT: LibraryDeployment<{ readonly ANEPC_API_ORIGIN: string }, AnepcContext> = {
  source: "anepc",
  name: "ANEPC active civil-protection occurrences",
  vars: { ANEPC_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(ANEPC_FEEDS),
    resolve: resolveAnepcFeed,
    context: { apiOrigin: env.ANEPC_API_ORIGIN },
  }),
};
