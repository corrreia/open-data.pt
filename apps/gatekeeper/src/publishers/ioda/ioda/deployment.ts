import type { LibraryDeployment } from "#/index";
import { resolveIodaFeed, type IodaContext } from "./collector";
import { IODA_FEEDS, IODA_HOST, iodaHosts } from "./ioda";

/** The one host its API answers on. */
export const IODA_DEPLOYMENT: LibraryDeployment<{ readonly IODA_ALLOWED_HOSTS: string }, IodaContext> = {
  source: "ioda",
  name: "IODA internet outage detection",
  vars: { IODA_ALLOWED_HOSTS: IODA_HOST },
  library: (env) => ({
    kinds: Object.values(IODA_FEEDS),
    resolve: resolveIodaFeed,
    context: { hosts: iodaHosts(env.IODA_ALLOWED_HOSTS) },
  }),
};
