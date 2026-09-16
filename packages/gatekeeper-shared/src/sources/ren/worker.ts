import type { LibraryDeployment } from "../../index";
import { renCollector } from "./collector";
import { REN_FEEDS } from "./ren";

/** The Data Hub's origin, and the service bus its chart data is POSTed to. */
export const REN_DEPLOYMENT: LibraryDeployment<{ readonly REN_API_ORIGIN: string; readonly REN_DATA_API_ORIGIN: string }> = {
  source: "ren",
  vars: { REN_API_ORIGIN: "https://datahub.ren.pt", REN_DATA_API_ORIGIN: "https://servicebus.ren.pt" },
  library: (env) => ({
    kinds: Object.values(REN_FEEDS),
    collector: (config) => renCollector({ config, apiOrigin: env.REN_API_ORIGIN, dataApiOrigin: env.REN_DATA_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
