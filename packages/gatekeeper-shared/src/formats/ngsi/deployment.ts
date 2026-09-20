import type { LibraryDeployment } from "../../index";
import { ngsiCollector } from "./collector";
import { NGSI_FEEDS } from "./ngsi";

/** The brokers its feeds may be read from. */
export const NGSI_DEPLOYMENT: LibraryDeployment<{ readonly NGSI_ALLOWED_HOSTS: string }> = {
  source: "ngsi",
  name: "FIWARE NGSI v2 brokers",
  vars: { NGSI_ALLOWED_HOSTS: "broker.fiware.urbanplatform.portodigital.pt" },
  library: (env) => ({
    kinds: Object.values(NGSI_FEEDS),
    collector: (config) => ngsiCollector({ config, hosts: env.NGSI_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
