import type { LibraryDeployment } from "#/index";
import { resolveDataStoreFeed, type DataStoreContext } from "./collector";
import { DATASTORE_API_ORIGIN, DATASTORE_FEEDS } from "./datastore";

interface DataStoreEnv {
  readonly EUMETSAT_API_ORIGIN: string;
  /** Secret: the EUMETSAT account's API consumer key (https://api.eumetsat.int/api-key/). */
  readonly EUMETSAT_CONSUMER_KEY?: string;
  /** Secret: the same account's consumer secret. */
  readonly EUMETSAT_CONSUMER_SECRET?: string;
}

export const DATASTORE_DEPLOYMENT: LibraryDeployment<DataStoreEnv, DataStoreContext> = {
  source: "datastore",
  name: "EUMETSAT Data Store",
  vars: { EUMETSAT_API_ORIGIN: DATASTORE_API_ORIGIN },
  secrets: ["EUMETSAT_CONSUMER_KEY", "EUMETSAT_CONSUMER_SECRET"],
  library: (env) => ({
    kinds: Object.values(DATASTORE_FEEDS),
    resolve: resolveDataStoreFeed,
    context: { apiOrigin: env.EUMETSAT_API_ORIGIN, credentials: { key: env.EUMETSAT_CONSUMER_KEY, secret: env.EUMETSAT_CONSUMER_SECRET } },
  }),
};
