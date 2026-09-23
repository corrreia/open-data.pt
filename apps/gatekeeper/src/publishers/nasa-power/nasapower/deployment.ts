import type { LibraryDeployment } from "#/index";
import { resolveNasaPowerFeed, type NasaPowerContext } from "./collector";
import { NASA_POWER_API_ORIGIN, NASA_POWER_FEEDS } from "./nasapower";

export const NASA_POWER_DEPLOYMENT: LibraryDeployment<{ readonly NASA_POWER_API_ORIGIN: string }, NasaPowerContext> = {
  source: "nasapower",
  name: "NASA POWER daily analysis",
  vars: { NASA_POWER_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(NASA_POWER_FEEDS),
    resolve: resolveNasaPowerFeed,
    context: { apiOrigin: env.NASA_POWER_API_ORIGIN },
  }),
};
