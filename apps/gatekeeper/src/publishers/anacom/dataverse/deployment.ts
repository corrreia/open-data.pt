import type { LibraryDeployment } from "#/index";
import { resolveDataverseFeed, type DataverseContext } from "./collector";
import { DATAVERSE_API_ORIGIN, DATAVERSE_FEEDS } from "./dataverse";

/** The one origin STAT.ANACOM's Dataverse Web API answers on. */
export const DATAVERSE_DEPLOYMENT: LibraryDeployment<{ readonly DATAVERSE_API_ORIGIN: string }, DataverseContext> = {
  source: "dataverse",
  name: "STAT.ANACOM indicator files",
  vars: { DATAVERSE_API_ORIGIN },
  library: (env) => ({
    kinds: Object.values(DATAVERSE_FEEDS),
    resolve: (config) => resolveDataverseFeed(config, env.DATAVERSE_API_ORIGIN),
    context: { apiOrigin: env.DATAVERSE_API_ORIGIN },
  }),
};
