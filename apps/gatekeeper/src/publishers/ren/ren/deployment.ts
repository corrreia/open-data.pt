import type { LibraryDeployment } from "#/index";
import { resolveRenFeed, type RenContext } from "./collector";
import { REN_FEEDS } from "./ren";

/** The Data Hub's origin, and the service bus its chart data is POSTed to. */
export const REN_DEPLOYMENT: LibraryDeployment<{ readonly REN_API_ORIGIN: string; readonly REN_DATA_API_ORIGIN: string }, RenContext> = {
  source: "ren",
  name: "REN electricity grid",
  vars: { REN_API_ORIGIN: "https://datahub.ren.pt", REN_DATA_API_ORIGIN: "https://servicebus.ren.pt" },
  library: (env) => ({
    kinds: Object.values(REN_FEEDS),
    resolve: resolveRenFeed,
    context: { apiOrigin: env.REN_API_ORIGIN, dataApiOrigin: env.REN_DATA_API_ORIGIN },
  }),
};
