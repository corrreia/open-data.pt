import { defineFeed } from "#/catalog/define";
import { SELECTED_SERIES_MONTHLY } from "#/publishers/banco-de-portugal/bpstat/feeds";
import { BPSTAT_DEPLOYMENT, BPSTAT_NORMALIZER, collectBpstatDataset, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/index";

export const FEED = defineFeed(BPSTAT_DEPLOYMENT, {
  slug: "bpstat-construction-business-financial-health",
  title: "Construction-sector business financial health",
  description:
    "Twelve quarterly ratios for private non-financial construction companies in Portugal: capital, profitability, debt, trade credit and payment periods. Latest twenty observations per series; not every business sector in the broader dataset.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  config: {
    domain: "168",
    dataset: "332441c9d65de71a0c842ac6496c1ee2",
    lang: "EN",
    seriesIds: "12587167,12587168,12587169,12587170,12587171,12587172,12587173,12587174,12587175,12587176,12587177,12587178",
    lastN: "20",
  },
  policy: SELECTED_SERIES_MONTHLY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest 20 observations of 12 selected series of BPstat dataset `332441c9d65de71a0c842ac6496c1ee2`, domain 168. */
  fetch: ({ config, validator, library, fetch }) => collectBpstatDataset(config, validator, library.apiOrigin, fetch),
  /** BPstat's JSON-stat answer, into one series per BPstat series. */
  transform: { normalizer: BPSTAT_NORMALIZER, buffered: (bytes, context) => transformBpstatDataset(bytes, context) },
});
