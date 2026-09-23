import type { LibraryDeployment } from "#/index";
import { myInfoOperators, resolveMyInfoFeed, type MyInfoContext } from "./collector";
import { MYINFO_FEEDS, MYINFO_ORIGIN } from "./myinfo";

/**
 * One origin, and the operator folders under it. Card4B's MYINFO is one
 * deployment shared by many operators, so what a feed may read is an operator
 * folder rather than a host: exactly the operators the publisher folders' feeds
 * name, so a new operator never edits this library.
 */
export const MYINFO_DEPLOYMENT: LibraryDeployment<{ readonly MYINFO_ORIGIN: string }, MyInfoContext> = {
  source: "myinfo",
  name: "Card4B MYINFO operator portals",
  vars: { MYINFO_ORIGIN },
  library: (env, publishers) => {
    const operators = myInfoOperators(publishers.configs);
    return {
      kinds: Object.values(MYINFO_FEEDS),
      resolve: (config) => resolveMyInfoFeed(config, operators),
      context: { apiOrigin: env.MYINFO_ORIGIN, operators },
    };
  },
};
