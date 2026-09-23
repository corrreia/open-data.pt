import type { LibraryDeployment } from "#/index";
import { resolveIneFeed, type IneContext } from "./collector";
import { INE_FEEDS } from "./ine";

/** The one origin its API answers on. */
export const INE_DEPLOYMENT: LibraryDeployment<{ readonly INE_API_ORIGIN: string }, IneContext> = {
  source: "ine",
  name: "INE, Statistics Portugal",
  vars: { INE_API_ORIGIN: "https://www.ine.pt" },
  library: (env) => ({
    kinds: Object.values(INE_FEEDS),
    resolve: resolveIneFeed,
    context: { apiOrigin: env.INE_API_ORIGIN },
  }),
};
