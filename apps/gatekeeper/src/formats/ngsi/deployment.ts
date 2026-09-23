import { allowedHosts, type LibraryDeployment } from "#/index";
import { resolveNgsiFeed, type NgsiContext } from "./collector";
import { NGSI_FEEDS, ngsiHosts } from "./ngsi";

/** The brokers its feeds may be read from. */
export const NGSI_DEPLOYMENT: LibraryDeployment<object, NgsiContext> = {
  source: "ngsi",
  name: "FIWARE NGSI v2 brokers",
  vars: {},
  library: (_env, publishers) => {
    const hosts = publishers.hosts.join(",");
    return {
      kinds: Object.values(NGSI_FEEDS),
      resolve: (config) => resolveNgsiFeed(config, ngsiHosts(hosts)),
      context: { hosts: allowedHosts(hosts) },
    };
  },
};
