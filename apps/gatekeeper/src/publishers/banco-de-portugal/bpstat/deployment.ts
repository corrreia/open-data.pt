import type { LibraryDeployment } from "#/index";
import { resolveBpstatFeed, type BpstatContext } from "./collector";
import { BPSTAT_FEEDS } from "./bpstat";

/** The one origin its API answers on. */
export const BPSTAT_DEPLOYMENT: LibraryDeployment<{ readonly BPSTAT_API_ORIGIN: string }, BpstatContext> = {
  source: "bpstat",
  name: "BPstat, Banco de Portugal",
  vars: { BPSTAT_API_ORIGIN: "https://bpstat.bportugal.pt" },
  library: (env) => ({
    kinds: Object.values(BPSTAT_FEEDS),
    resolve: resolveBpstatFeed,
    context: { apiOrigin: env.BPSTAT_API_ORIGIN },
  }),
};
