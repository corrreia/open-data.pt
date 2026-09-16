import type { LibraryDeployment } from "../../index";
import { ckanCollector } from "./collector";
import { CKAN_FEEDS } from "./ckan";

/** Hosts its feeds may be read from. */
export const CKAN_DEPLOYMENT: LibraryDeployment<{ readonly CKAN_ALLOWED_HOSTS: string }> = {
  source: "ckan",
  vars: { CKAN_ALLOWED_HOSTS: "opendata.porto.digital,dadosabertos.cascais.pt,dadosabertos.cm-agueda.pt,oeirasinterativa.oeiras.pt" },
  library: (env) => ({
    kinds: Object.values(CKAN_FEEDS),
    collector: (config) => ckanCollector({ config, hosts: env.CKAN_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
