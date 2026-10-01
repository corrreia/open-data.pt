import type { LibraryDeployment } from "#/index";
import { resolveIpmaFeed, type IpmaContext } from "./collector";
import { IPMA_FEEDS } from "./ipma";
import { IPMA_WEB_ORIGIN } from "./lightning";

/** The origin its API answers on, and its website's. */
export const IPMA_DEPLOYMENT: LibraryDeployment<{ readonly IPMA_API_ORIGIN: string; readonly IPMA_WEB_ORIGIN: string }, IpmaContext> = {
  source: "ipma",
  name: "IPMA weather and sea",
  vars: { IPMA_API_ORIGIN: "https://api.ipma.pt", IPMA_WEB_ORIGIN },
  library: (env) => ({
    kinds: Object.values(IPMA_FEEDS),
    resolve: resolveIpmaFeed,
    context: { apiOrigin: env.IPMA_API_ORIGIN, webOrigin: env.IPMA_WEB_ORIGIN },
  }),
};
