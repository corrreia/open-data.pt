import type { LibraryDeployment } from "../../../index";
import { metrolisboaCollector } from "./collector";
import { METRO_FEEDS } from "./metrolisboa";

interface MetrolisboaEnv {
  readonly METROLISBOA_API_ORIGIN: string;
  /** Secret: the Metro Lisboa API store application's consumer key. */
  readonly ML_CONSUMER_KEY?: string;
  /** Secret: the same application's consumer secret. */
  readonly ML_CONSUMER_SECRET?: string;
}

export const METROLISBOA_DEPLOYMENT: LibraryDeployment<MetrolisboaEnv> = {
  source: "metrolisboa",
  name: "Metro Lisboa",
  // Where the EstadoServicoML gateway answers: our own proxy hostname. Metro's port 8243 sends an
  // incomplete certificate chain that a Worker refuses (error 526). lisboa-metro.open-data.pt is a
  // proxied CNAME to api.metrolisboa.pt whose origin rule sends it to port 8243 with SSL "full".
  // The token endpoint is fixed on port 443, whose chain is complete.
  vars: { METROLISBOA_API_ORIGIN: "https://lisboa-metro.open-data.pt" },
  secrets: ["ML_CONSUMER_KEY", "ML_CONSUMER_SECRET"],
  library: (env) => ({
    kinds: Object.values(METRO_FEEDS),
    collector: (config) =>
      metrolisboaCollector({
        config,
        apiOrigin: env.METROLISBOA_API_ORIGIN,
        credentials: { key: env.ML_CONSUMER_KEY, secret: env.ML_CONSUMER_SECRET },
        fetcher: (input, init) => fetch(input, init),
      }),
  }),
};
