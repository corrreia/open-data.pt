import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "base-procurement-entities-feed",
  config: {
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    dataset: "67d80b2c4750b888116940fb",
    format: "json",
    productSlug: "base-procurement-entities",
    productTitle: "Public-procurement entities",
    distributionId: "d85c49f0-b6ab-4cb7-afbe-4e103016b9a0",
    keyField: "nifEntidade",
  },
  policy: {
    name: "Public-procurement entities",
    version: 1,
    collection: { cadenceSeconds: 2_592_000, timeoutSeconds: 240, maxBytes: 80 * MIB, maxOutputBytes: 160 * MIB, historyMode: "changes" },
  },
  staleAfterSeconds: 7_776_000,
  /** Once a month: IMPIC's procurement entities JSON on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The JSON, read generically, into one record per entity. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
