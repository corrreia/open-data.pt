import type { LibraryDeployment } from "../../index";
import { iodaCollector } from "./collector";
import { IODA_FEEDS, IODA_HOST } from "./ioda";

/** The one host its API answers on. */
export const IODA_DEPLOYMENT: LibraryDeployment<{ readonly IODA_ALLOWED_HOSTS: string }> = {
  source: "ioda",
  name: "IODA internet outage detection",
  vars: { IODA_ALLOWED_HOSTS: IODA_HOST },
  library: (env) => ({
    kinds: Object.values(IODA_FEEDS),
    collector: (config) => iodaCollector({ config, hosts: env.IODA_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
