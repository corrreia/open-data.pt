import { defineFeed } from "#/catalog/define";
import type { CollectionPolicyDefinition } from "#/index";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MEBIBYTE, MONTH } from "#/formats/ogc/feeds";
import { CRUS_COLUMNS, DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-crus-feed",
  config: {
    host: DGT_HOST,
    collection: "crus",
    geometry: "skip",
    properties: CRUS_COLUMNS,
    pageSize: "5000",
    maxPages: "60",
  },
  policy: {
    name: "CRUS national register",
    version: 1,
    collection: {
      // A municipal plan is revised over years, and the acts that revise one
      // are already read weekly from the register that publishes them. Monthly
      // is what the redrawn charter itself changes at, and it asks this service
      // for one walk a month rather than 278.
      cadenceSeconds: 2_592_000,
      // The walk alone measured 109 seconds, and reading it end to end through
      // the kernel took 292. In production the same run also normalises, stages
      // and writes every row, and 600 seconds was not enough for it; this is
      // room for the whole of that, on a feed that runs once a month.
      timeoutSeconds: 1_800,
      maxBytes: 256 * MEBIBYTE,
      maxOutputBytes: 192 * MEBIBYTE,
      // The largest parcel row measured is 723 bytes.
      maxRecordBytes: 16 * 1024,
      maxRecords: 400_000,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
  },
  staleAfterSeconds: 2 * MONTH,
  /** Once a month: every parcel of the crus layer from DGT's OGC API, its columns without outlines, five thousand a page. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of parcels. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
