import type { LibraryDeployment } from "../../../index";
import { eurostatCollector } from "./collector";
import { EUROSTAT_FEEDS } from "./eurostat";

/** The one origin its API answers on. */
export const EUROSTAT_DEPLOYMENT: LibraryDeployment<{ readonly EUROSTAT_API_ORIGIN: string }> = {
  source: "eurostat",
  name: "Eurostat",
  vars: { EUROSTAT_API_ORIGIN: "https://ec.europa.eu" },
  library: (env) => ({
    kinds: Object.values(EUROSTAT_FEEDS),
    collector: (config) => eurostatCollector({ config, apiOrigin: env.EUROSTAT_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
