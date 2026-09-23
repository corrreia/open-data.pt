import type { LibraryDeployment } from "#/index";
import { resolveUsgsFeed, type UsgsContext } from "./collector";
import { USGS_API_ORIGIN, USGS_FEEDS } from "./usgs";

export const USGS_DEPLOYMENT: LibraryDeployment<{ readonly USGS_API_ORIGIN: string }, UsgsContext> = {
  source: "usgs",
  name: "USGS earthquake catalog",
  vars: { USGS_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(USGS_FEEDS),
    resolve: resolveUsgsFeed,
    context: { apiOrigin: env.USGS_API_ORIGIN },
  }),
};
