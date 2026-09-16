import type { LibraryDeployment } from "../../index";
import { gtfsCollector } from "./collector";
import { GTFS_FEEDS } from "./gtfs";

/** Hosts its feeds may be read from. */
export const GTFS_DEPLOYMENT: LibraryDeployment<{ readonly GTFS_ALLOWED_HOSTS: string }> = {
  source: "gtfs",
  // One GTFS archive is tens of megabytes of CSV, parsed in a single invocation.
  cpuMs: 120_000,
  vars: {
    GTFS_ALLOWED_HOSTS: "api.carrismetropolitana.pt,opendata.porto.digital,dados.gov.pt,publico.cp.pt,www.fertagus.pt,www.tub.pt,backend.tcbarreiro.pt,www.horariosdofunchal.pt",
  },
  library: (env) => ({
    kinds: Object.values(GTFS_FEEDS),
    collector: (config) => gtfsCollector({ config, hosts: env.GTFS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
