import { defineFeed } from "#/catalog/define";
import { REN_DEPLOYMENT, REN_PERIODIC_NORMALIZER, collectRenPeriodic, transformRenPeriodic } from "#/publishers/ren/ren/index";

export const FEED = defineFeed(REN_DEPLOYMENT, {
  slug: "ren-gas-storage-feed",
  title: "REN underground natural gas storage",
  description:
    "Total injections, withdrawals, stored energy and fullness at underground gas storage for the latest seven completed calendar days available. Daily reports may be published with a lag; missing reports are not zero.",
  licence: "ren-datahub",
  attribution: "REN — Redes Energéticas Nacionais",
  topics: ["energy"],
  config: { service: "gas-storage" },
  policy: {
    name: "REN daily storage balance",
    version: 2,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 512 * 1024, historyMode: "changes" },
  },
  staleAfterSeconds: 3 * 86_400,
  /** Once a day: the service bus's underground storage balance for each of the last seven days. */
  fetch: ({ config, validator, signal, library, fetch, now }) => collectRenPeriodic({ config, apiOrigin: library.dataApiOrigin, fetcher: fetch, now }, validator, signal),
  /** The daily balances, into one series per measure. */
  transform: { normalizer: REN_PERIODIC_NORMALIZER, streaming: transformRenPeriodic },
});
