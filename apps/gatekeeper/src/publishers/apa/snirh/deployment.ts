import type { LibraryDeployment } from "#/index";
import { resolveSnirhFeed, type SnirhContext } from "./collector";
import { SNIRH_FEEDS, SNIRH_ORIGIN } from "./snirh";

export const SNIRH_DEPLOYMENT: LibraryDeployment<{ readonly SNIRH_API_ORIGIN: string }, SnirhContext> = {
  source: "snirh",
  name: "SNIRH water resources",
  vars: { SNIRH_API_ORIGIN: SNIRH_ORIGIN },
  library: (env) => ({
    kinds: Object.values(SNIRH_FEEDS),
    resolve: resolveSnirhFeed,
    context: { apiOrigin: env.SNIRH_API_ORIGIN },
  }),
};
