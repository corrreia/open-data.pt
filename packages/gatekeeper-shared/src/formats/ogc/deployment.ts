import type { LibraryDeployment } from "../../index";
import { ogcCollector } from "./collector";
import { OGC_FEEDS } from "./ogc";

/** Hosts its feeds may be read from. */
export const OGC_DEPLOYMENT: LibraryDeployment<{ readonly OGC_ALLOWED_HOSTS: string }> = {
  source: "ogc",
  name: "OGC API Features services",
  // ambiente.azores.gov.pt was dropped in September 2026 with its examples: its Cloudflare
  // managed challenge answers every request from our Workers with 403 (`cf-mitigated: challenge`).
  vars: { OGC_ALLOWED_HOSTS: "ogcapi.dgterritorio.gov.pt" },
  library: (env) => ({
    kinds: Object.values(OGC_FEEDS),
    collector: (config) => ogcCollector({ config, hosts: env.OGC_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
