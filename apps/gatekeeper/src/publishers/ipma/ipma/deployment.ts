import type { LibraryDeployment } from "#/index";
import { resolveIpmaFeed, type IpmaContext } from "./collector";
import { IPMA_FEEDS } from "./ipma";

/** The one origin its API answers on. */
export const IPMA_DEPLOYMENT: LibraryDeployment<{ readonly IPMA_API_ORIGIN: string }, IpmaContext> = {
  source: "ipma",
  name: "IPMA weather and sea",
  vars: { IPMA_API_ORIGIN: "https://api.ipma.pt" },
  library: (env) => ({
    kinds: Object.values(IPMA_FEEDS),
    resolve: resolveIpmaFeed,
    context: { apiOrigin: env.IPMA_API_ORIGIN },
  }),
};
