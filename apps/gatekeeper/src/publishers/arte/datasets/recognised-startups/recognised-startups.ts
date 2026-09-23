import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "recognised-startups-feed",
  config: {
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    // ARTE uploads every monthly release as a new resource, so no id is pinned.
    dataset: "660c3c451ee8ad9bd6b60608",
    format: "json",
    productSlug: "recognised-startups",
    productTitle: "Companies recognised with startup status",
    keyField: "titularNipc",
    eventTimeField: "fileDate",
  },
  policy: {
    name: "Companies recognised with startup status",
    version: 1,
    collection: { cadenceSeconds: 604_800, timeoutSeconds: 240, maxBytes: 2 * MIB, maxOutputBytes: 8 * MIB, historyMode: "changes" },
  },
  staleAfterSeconds: 1_814_400,
  /** Once a week: the newest JSON release in ARTE's startup registry dataset on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The JSON, read generically, into one record per company. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
