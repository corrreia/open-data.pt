import type { LibraryDeployment } from "../../index";
import { ngsiCollector } from "./collector";
import { NGSI_FEEDS } from "./ngsi";

/** The brokers its feeds may be read from. */
export const NGSI_DEPLOYMENT: LibraryDeployment<object> = {
  source: "ngsi",
  name: "FIWARE NGSI v2 brokers",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(NGSI_FEEDS),
    collector: (config) => ngsiCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
