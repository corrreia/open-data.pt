import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "cada-opinions-2025-feed",
  config: {
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    dataset: "6a886960e18b67254bb6b93b",
    format: "csv",
    productSlug: "cada-opinions-2025",
    productTitle: "CADA administrative-document access opinions for 2025",
    distributionId: "e10e5071-90ea-42cc-aea3-8710222339ba",
    keyField: "N.º Parecer",
    eventTimeField: "Data Parecer",
  },
  policy: {
    name: "CADA administrative-document access opinions for 2025",
    version: 1,
    collection: { cadenceSeconds: 2_592_000, timeoutSeconds: 240, maxBytes: 2 * MIB, maxOutputBytes: 8 * MIB, historyMode: "changes" },
  },
  staleAfterSeconds: 7_776_000,
  /** Once a month: CADA's 2025 opinions CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, read generically, into one record per opinion. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
