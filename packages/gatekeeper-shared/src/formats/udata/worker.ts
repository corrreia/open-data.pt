import type { LibraryDeployment } from "../../index";
import { UDATA_FEEDS, udataCollector } from "./collector";

/** Hosts its feeds may be read from. */
export const UDATA_DEPLOYMENT: LibraryDeployment<{ readonly UDATA_ALLOWED_HOSTS: string }> = {
  source: "udata",
  vars: { UDATA_ALLOWED_HOSTS: "dados.gov.pt" },
  library: (env) => ({
    kinds: Object.values(UDATA_FEEDS),
    collector: (config) => udataCollector({ config, hosts: env.UDATA_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
