import { defineFeed } from "#/catalog/define";
import { REN_DEPLOYMENT, REN_PERIODIC_NORMALIZER, collectRenPeriodic, transformRenPeriodic } from "#/publishers/ren/ren/index";

export const FEED = defineFeed(REN_DEPLOYMENT, {
  slug: "ren-installed-capacity-feed",
  title: "REN installed generating capacity",
  description:
    "Installed generating capacity by source for the latest three completed calendar months available from REN. Unpublished and null observations are not reported as zero.",
  config: { service: "installed-capacity" },
  policy: {
    name: "REN monthly capacity",
    version: 2,
    collection: { cadenceSeconds: 604_800, timeoutSeconds: 90, maxBytes: 512 * 1024, historyMode: "changes" },
  },
  staleAfterSeconds: 1_209_600,
  /** Once a week: the service bus's installed capacity for each of the last three completed months. */
  fetch: ({ config, validator, signal, library, fetch, now }) => collectRenPeriodic({ config, apiOrigin: library.dataApiOrigin, fetcher: fetch, now }, validator, signal),
  /** The monthly answers, into one capacity series per technology. */
  transform: { normalizer: REN_PERIODIC_NORMALIZER, streaming: transformRenPeriodic },
});
