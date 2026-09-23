import { allowedHosts, type LibraryDeployment } from "#/index";
import { resolveOpendatasoftFeed, type OpendatasoftContext } from "./collector";
import { OPENDATASOFT_FEEDS } from "./opendatasoft";

/** No origin of its own: the hosts it may read are exactly the ones the publisher folders' feeds name. */
export const OPENDATASOFT_DEPLOYMENT: LibraryDeployment<object, OpendatasoftContext> = {
  source: "opendatasoft",
  name: "Opendatasoft portals",
  vars: {},
  library: (_env, publishers) => {
    const hosts = allowedHosts(publishers.hosts.join(","));
    return {
      kinds: Object.values(OPENDATASOFT_FEEDS),
      resolve: (config) => resolveOpendatasoftFeed(config, hosts),
      context: { hosts },
    };
  },
};
