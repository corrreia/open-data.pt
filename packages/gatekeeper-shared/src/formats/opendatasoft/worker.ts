import type { LibraryDeployment } from "../../index";
import { opendatasoftCollector } from "./collector";
import { OPENDATASOFT_FEEDS } from "./opendatasoft";

/** Hosts its feeds may be read from. */
export const OPENDATASOFT_DEPLOYMENT: LibraryDeployment<{ readonly OPENDATASOFT_ALLOWED_HOSTS: string }> = {
  source: "opendatasoft",
  name: "Opendatasoft portals",
  vars: { OPENDATASOFT_ALLOWED_HOSTS: "e-redes.opendatasoft.com,transparencia.sns.gov.pt" },
  library: (env) => ({
    kinds: Object.values(OPENDATASOFT_FEEDS),
    collector: (config) => opendatasoftCollector({ config, hosts: env.OPENDATASOFT_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
