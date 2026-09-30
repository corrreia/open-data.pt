import type { LibraryDeployment } from "#/index";
import { resolveQualarFeed, type QualarContext } from "./collector";
import { QUALAR_FEEDS, QUALAR_ORIGIN } from "./qualar";

export const QUALAR_DEPLOYMENT: LibraryDeployment<{ readonly QUALAR_API_ORIGIN: string }, QualarContext> = {
  source: "qualar",
  name: "QualAr air quality",
  vars: { QUALAR_API_ORIGIN: QUALAR_ORIGIN },
  library: (env) => ({
    kinds: Object.values(QUALAR_FEEDS),
    resolve: resolveQualarFeed,
    context: { apiOrigin: env.QUALAR_API_ORIGIN },
  }),
};
