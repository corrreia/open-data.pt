import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "base-contract-modifications-2026-feed",
  config: {
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    dataset: "668d65dbcb1b953e80198435",
    format: "json",
    productSlug: "base-contract-modifications-2026",
    productTitle: "Public-contract modifications published in 2026",
    distributionId: "d6d13c09-418e-443b-bbf4-b9bd77097571",
    keyField: "idcontrato",
    eventTimeField: "modifDataPublicacao",
  },
  policy: {
    name: "Public-contract modifications published in 2026",
    version: 1,
    collection: { cadenceSeconds: 604_800, timeoutSeconds: 240, maxBytes: 8 * MIB, maxOutputBytes: 32 * MIB, historyMode: "changes" },
  },
  staleAfterSeconds: 1_814_400,
  /** Once a week: IMPIC's 2026 contract modifications JSON on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The JSON, read generically, into one record per modification. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
