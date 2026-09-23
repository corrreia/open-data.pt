import { allowedHosts, type LibraryDeployment } from "#/index";
import { UDATA_FEEDS, resolveUdataFeed, type UdataContext } from "./collector";

export const UDATA_DEPLOYMENT: LibraryDeployment<object, UdataContext> = {
  source: "udata",
  name: "uData portals",
  vars: {},
  library: (_env, publishers) => {
    const hosts = allowedHosts(publishers.hosts.join(","));
    return {
      kinds: Object.values(UDATA_FEEDS),
      resolve: (config) => resolveUdataFeed(config, hosts),
      context: { hosts },
    };
  },
};
