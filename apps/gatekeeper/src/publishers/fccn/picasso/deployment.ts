import type { LibraryDeployment } from "#/index";
import { resolvePicassoFeed, type PicassoContext } from "./collector";
import { PICASSO_FEEDS, PICASSO_ORIGIN } from "./picasso";

export const PICASSO_DEPLOYMENT: LibraryDeployment<{ readonly PICASSO_API_ORIGIN: string }, PicassoContext> = {
  source: "picasso",
  name: "Picasso, FCCN's network statistics",
  vars: { PICASSO_API_ORIGIN: PICASSO_ORIGIN },
  library: (env) => ({
    kinds: Object.values(PICASSO_FEEDS),
    resolve: resolvePicassoFeed,
    context: { apiOrigin: env.PICASSO_API_ORIGIN },
  }),
};
