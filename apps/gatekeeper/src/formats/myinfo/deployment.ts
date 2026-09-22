import type { LibraryDeployment } from "#/index";
import { myInfoCollector } from "./collector";
import { MYINFO_FEEDS, MYINFO_ORIGIN } from "./myinfo";

/**
 * One origin, and the operator folders under it this Worker may read. Card4B's
 * MYINFO is one deployment shared by many operators, so the allowlist names
 * folders rather than hosts.
 */
export const MYINFO_DEPLOYMENT: LibraryDeployment<{ readonly MYINFO_ORIGIN: string; readonly MYINFO_OPERATORS: string }> = {
  source: "myinfo",
  name: "Card4B MYINFO operator portals",
  vars: {
    MYINFO_ORIGIN,
    MYINFO_OPERATORS: "BarraqueiroOeste,BoaViagem,Ribatejana,mare",
  },
  library: (env) => ({
    kinds: Object.values(MYINFO_FEEDS),
    collector: (config) => myInfoCollector({ config, apiOrigin: env.MYINFO_ORIGIN, operators: env.MYINFO_OPERATORS, fetcher: (input, init) => fetch(input, init) }),
  }),
};
