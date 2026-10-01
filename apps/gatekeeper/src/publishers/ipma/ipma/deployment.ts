import type { LibraryDeployment } from "#/index";
import { resolveIpmaFeed, type IpmaContext } from "./collector";
import { IPMA_MF2_ORIGIN } from "./fires";
import { IPMA_FEEDS } from "./ipma";

/** The origin its API answers on, and the one its dataservices site does. */
export const IPMA_DEPLOYMENT: LibraryDeployment<{ readonly IPMA_API_ORIGIN: string; readonly IPMA_MF2_ORIGIN: string }, IpmaContext> = {
  source: "ipma",
  name: "IPMA weather and sea",
  vars: { IPMA_API_ORIGIN: "https://api.ipma.pt", IPMA_MF2_ORIGIN },
  library: (env) => ({
    kinds: Object.values(IPMA_FEEDS),
    resolve: resolveIpmaFeed,
    context: { apiOrigin: env.IPMA_API_ORIGIN, mf2Origin: env.IPMA_MF2_ORIGIN },
  }),
};
