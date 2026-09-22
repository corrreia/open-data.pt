import type { LibraryDeployment } from "../../index";
import { anepcCollector } from "./collector";
import { ANEPC_API_ORIGIN, ANEPC_FEEDS } from "./anepc";

export const ANEPC_DEPLOYMENT: LibraryDeployment<{ readonly ANEPC_API_ORIGIN: string }> = {
  source: "anepc",
  name: "ANEPC active civil-protection occurrences",
  vars: { ANEPC_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(ANEPC_FEEDS),
    collector: (config) => anepcCollector({ config, apiOrigin: env.ANEPC_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
