import { defineFeed } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-payment-system-participants",
  config: { domain: "8", dataset: "00ac0311f09ecac48b82a9d92f8aa462", lang: "EN" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 604_800,
  /** Once a day: the whole of BPstat dataset `00ac0311f09ecac48b82a9d92f8aa462`, domain 8. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
