import type { LibraryDeployment } from "#/index";
import { infoaguaCollector } from "./collector";
import { INFOAGUA_FEEDS, INFOAGUA_ORIGIN } from "./infoagua";

export const INFOAGUA_DEPLOYMENT: LibraryDeployment<{ readonly INFOAGUA_API_ORIGIN: string }> = {
  source: "infoagua",
  name: "InfoÁgua flood and drought alerts",
  vars: { INFOAGUA_API_ORIGIN: INFOAGUA_ORIGIN },
  library: (env) => ({
    kinds: Object.values(INFOAGUA_FEEDS),
    collector: (config) => infoaguaCollector({ config, apiOrigin: env.INFOAGUA_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
  }),
};
