import type { LibraryDeployment } from "../../index";
import { firmsCollector } from "./collector";
import { FIRMS_API_ORIGIN, FIRMS_FEEDS } from "./firms";

interface FirmsEnv {
  readonly NASA_FIRMS_API_ORIGIN: string;
  readonly NASA_FIRMS_MAP_KEY: string;
}

export const FIRMS_DEPLOYMENT: LibraryDeployment<FirmsEnv> = {
  source: "firms",
  name: "NASA FIRMS thermal anomalies",
  vars: { NASA_FIRMS_API_ORIGIN: FIRMS_API_ORIGIN },
  secrets: ["NASA_FIRMS_MAP_KEY"],
  library: (env) => ({
    kinds: Object.values(FIRMS_FEEDS),
    collector: (config) => firmsCollector({ config, apiOrigin: env.NASA_FIRMS_API_ORIGIN, mapKey: env.NASA_FIRMS_MAP_KEY, fetcher: (input, init) => fetch(input, init) }),
  }),
};
