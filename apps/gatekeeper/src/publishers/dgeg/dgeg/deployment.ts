import type { LibraryDeployment } from "#/index";
import { publisherClient } from "#/publisher-client";
import { resolveDgegFeed, type DgegContext } from "./collector";
import { DGEG_FEEDS } from "./dgeg";

/** The one origin its API answers on. */
export const DGEG_DEPLOYMENT: LibraryDeployment<{ readonly DGEG_API_ORIGIN: string }, DgegContext> = {
  source: "dgeg",
  name: "DGEG fuel prices",
  vars: { DGEG_API_ORIGIN: "https://precoscombustiveis.dgeg.gov.pt" },
  library: (env, publishers) => ({
    kinds: Object.values(DGEG_FEEDS),
    // Checking a feed reads DGEG's reference lists, so it goes through the same client a run does.
    resolve: (config) =>
      resolveDgegFeed(
        config,
        env.DGEG_API_ORIGIN,
        publisherClient(publishers.hosts, (input, init) => fetch(input, init)),
      ),
    context: { apiOrigin: env.DGEG_API_ORIGIN },
  }),
};
