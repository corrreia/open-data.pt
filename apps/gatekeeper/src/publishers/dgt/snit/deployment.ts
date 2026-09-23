import type { LibraryDeployment } from "#/index";
import { resolveSnitFeed, type SnitContext } from "./collector";
import { SNIT_API_ORIGIN, SNIT_FEEDS } from "./snit";

export const SNIT_DEPLOYMENT: LibraryDeployment<{ readonly SNIT_API_ORIGIN: string }, SnitContext> = {
  source: "snit",
  name: "SNIT territorial management instruments",
  vars: { SNIT_API_ORIGIN },
  // The master plans come back as about 6 MB of JSON that is parsed, re-encoded
  // and digested before a row is emitted; that is past the default CPU budget,
  // as it is for the other libraries that buffer a body this size.
  cpuMs: 120_000,
  library: (env) => ({
    kinds: Object.values(SNIT_FEEDS),
    resolve: resolveSnitFeed,
    context: { apiOrigin: env.SNIT_API_ORIGIN },
  }),
};
