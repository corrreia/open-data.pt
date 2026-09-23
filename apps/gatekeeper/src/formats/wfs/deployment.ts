import { allowedHosts, type LibraryDeployment } from "#/index";
import { resolveWfsFeed, type WfsContext } from "./collector";
import { WFS_FEEDS, wfsHosts } from "./wfs";

/** Any WFS a publisher folder's feed names: its hosts are the only ones this library may fetch. */
export const WFS_DEPLOYMENT: LibraryDeployment<object, WfsContext> = {
  source: "wfs",
  name: "OGC Web Feature Services",
  vars: {},
  cpuMs: 120_000,
  library: (_env, publishers) => {
    const named = publishers.hosts.join(",");
    return {
      kinds: Object.values(WFS_FEEDS),
      // A feed is refused outright when no publisher names a WFS host at all.
      resolve: (config) => resolveWfsFeed(config, wfsHosts(named)),
      context: { hosts: allowedHosts(named) },
    };
  },
};
