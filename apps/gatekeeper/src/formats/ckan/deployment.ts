import type { LibraryDeployment } from "../../index";
import { ckanCollector } from "./collector";
import { CKAN_FEEDS } from "./ckan";

export const CKAN_DEPLOYMENT: LibraryDeployment<object> = {
  source: "ckan",
  name: "CKAN portals",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(CKAN_FEEDS),
    collector: (config) => ckanCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
