import type { LibraryDeployment } from "#/index";
import { nasaPowerCollector } from "./collector";
import { NASA_POWER_API_ORIGIN, NASA_POWER_FEEDS } from "./nasapower";

export const NASA_POWER_DEPLOYMENT: LibraryDeployment<{ readonly NASA_POWER_API_ORIGIN: string }> = {
  source: "nasapower",
  name: "NASA POWER daily analysis",
  vars: { NASA_POWER_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(NASA_POWER_FEEDS),
    collector: (config) => nasaPowerCollector({ config, apiOrigin: env.NASA_POWER_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
