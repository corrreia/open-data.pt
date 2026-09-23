import { allowedHosts, type LibraryDeployment } from "#/index";
import { resolveCkanFeed, type CkanContext } from "./collector";
import { CKAN_FEEDS } from "./ckan";

export const CKAN_DEPLOYMENT: LibraryDeployment<object, CkanContext> = {
  source: "ckan",
  name: "CKAN portals",
  vars: {},
  library: (_env, publishers) => {
    const hosts = allowedHosts(publishers.hosts.join(","));
    return {
      kinds: Object.values(CKAN_FEEDS),
      resolve: (config) => resolveCkanFeed(config, hosts),
      context: { hosts },
    };
  },
};
