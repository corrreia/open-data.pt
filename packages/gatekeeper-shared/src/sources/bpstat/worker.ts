import type { LibraryDeployment } from "../../index";
import { bpstatCollector } from "./collector";
import { BPSTAT_FEEDS } from "./bpstat";

/** The one origin its API answers on. */
export const BPSTAT_DEPLOYMENT: LibraryDeployment<{ readonly BPSTAT_API_ORIGIN: string }> = {
  source: "bpstat",
  vars: { BPSTAT_API_ORIGIN: "https://bpstat.bportugal.pt" },
  library: (env) => ({
    kinds: Object.values(BPSTAT_FEEDS),
    collector: (config) => bpstatCollector({ config, apiOrigin: env.BPSTAT_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
