import type { LibraryDeployment } from "../../index";
import { wfsCollector } from "./collector";
import { WFS_FEEDS } from "./wfs";

export const WFS_DEPLOYMENT: LibraryDeployment<{ readonly WFS_ALLOWED_HOSTS: string }> = {
  source: "wfs",
  name: "OGC Web Feature Services",
  vars: { WFS_ALLOWED_HOSTS: "maps.effis.emergency.copernicus.eu" },
  cpuMs: 120_000,
  library: (env) => ({
    kinds: Object.values(WFS_FEEDS),
    collector: (config) => wfsCollector({ config, hosts: env.WFS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
