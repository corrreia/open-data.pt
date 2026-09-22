import type { LibraryDeployment } from "../../index";
import { snirhCollector } from "./collector";
import { SNIRH_FEEDS, SNIRH_ORIGIN } from "./snirh";

export const SNIRH_DEPLOYMENT: LibraryDeployment<{ readonly SNIRH_API_ORIGIN: string }> = {
  source: "snirh",
  name: "SNIRH water resources",
  vars: { SNIRH_API_ORIGIN: SNIRH_ORIGIN },
  library: (env) => ({
    kinds: Object.values(SNIRH_FEEDS),
    collector: (config) => snirhCollector({ config, apiOrigin: env.SNIRH_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
