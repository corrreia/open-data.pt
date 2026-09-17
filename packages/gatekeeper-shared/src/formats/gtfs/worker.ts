import type { LibraryDeployment } from "../../index";
import { gtfsCollector } from "./collector";
import { GTFS_FEEDS } from "./gtfs";

/** Hosts its feeds may be read from. */
export const GTFS_DEPLOYMENT: LibraryDeployment<{ readonly GTFS_ALLOWED_HOSTS: string }> = {
  source: "gtfs",
  name: "GTFS transit feeds",
  // One GTFS archive is tens of megabytes of CSV, parsed in a single invocation.
  cpuMs: 120_000,
  vars: {
    // opendata.porto.digital was dropped in September 2026: Porto's portal moved to
    // dadosabertos.cm-porto.pt and the old name no longer resolves at all.
    GTFS_ALLOWED_HOSTS: "api.carrismetropolitana.pt,dadosabertos.cm-porto.pt,dados.gov.pt,publico.cp.pt,www.fertagus.pt,www.tub.pt,backend.tcbarreiro.pt,www.horariosdofunchal.pt",
  },
  library: (env) => ({
    kinds: Object.values(GTFS_FEEDS),
    collector: (config) => gtfsCollector({ config, hosts: env.GTFS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
