import type { LibraryDeployment } from "../../index";
import { arcgisCollector } from "./collector";
import { ARCGIS_FEEDS } from "./arcgis";

/** Hosts its feeds may be read from. */
export const ARCGIS_DEPLOYMENT: LibraryDeployment<{ readonly ARCGIS_ALLOWED_HOSTS: string }> = {
  source: "arcgis",
  vars: { ARCGIS_ALLOWED_HOSTS: "services.arcgis.com,sniambgeoogc.apambiente.pt" },
  library: (env) => ({
    kinds: Object.values(ARCGIS_FEEDS),
    collector: (config) => arcgisCollector({ config, hosts: env.ARCGIS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
