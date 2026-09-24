import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "base-procurement-notices-2026-feed",
  title: "Public-procurement notices published in 2026",
  description:
    "IMPIC's 2026 procurement notices, including contracting authorities, base prices, procedures, deadlines and source links. One current record per notice; not a duplicate of signed contracts.",
  licence: "other-pd",
  attribution: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
  topics: ["government"],
  config: {
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    dataset: "66d72fbc58cd7a63dae28712",
    format: "json",
    productSlug: "base-procurement-notices-2026",
    productTitle: "Public-procurement notices published in 2026",
    distributionId: "1002987e-8985-492f-9215-e732fffdbc83",
    keyField: "nAnuncio",
    eventTimeField: "dataPublicacao",
  },
  policy: {
    name: "Public-procurement notices published in 2026",
    version: 1,
    collection: { cadenceSeconds: 604_800, timeoutSeconds: 240, maxBytes: 48 * MIB, maxOutputBytes: 96 * MIB, historyMode: "changes" },
  },
  staleAfterSeconds: 1_814_400,
  /** Once a week: IMPIC's 2026 procurement notices JSON on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The JSON, read generically, into one record per notice. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
