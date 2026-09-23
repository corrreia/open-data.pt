import { defineFeed } from "#/catalog/define";
import type { CollectionPolicyDefinition } from "#/index";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { HOUR, MEBIBYTE } from "#/formats/ogc/feeds";
import { CRUS_COLUMNS, DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-crus-shapes-feed",
  config: {
    host: DGT_HOST,
    collection: "crus",
    geometry: "include",
    properties: CRUS_COLUMNS,
    shardField: "dtcc",
    shardSource: "municipios",
    shardSourceField: "dtmn",
    /*
     * Twenty-four municipalities a run, which is twelve runs for the country.
     * Every one of the 278 was counted: 234,768 parcels, and at the 21 KiB of
     * pretty-printed outline a parcel averages, a run of twenty-four reads 401
     * MiB on average and 495 MiB at its worst. Shards are taken in code order,
     * so a run reads municipalities from the same district and the worst group
     * is a real one, not a coincidence — and a run that runs out of bytes never
     * reaches its completion frame, so its cursor never moves and the feed would
     * wedge on that group for good. The budget below covers the worst group with
     * room, rather than the average with none.
     */
    shardsPerRun: "24",
    pageSize: "500",
    maxPages: "60",
  },
  policy: {
    name: "CRUS parcel boundaries",
    version: 2,
    collection: {
      /*
       * Hourly, which is not a claim that the charter changes hourly. A run
       * reads a different twelfth of the country, so what this sets is how long
       * the map takes to fill: twelve hours, against the three months a weekly
       * run needed — which is why the country has been showing in patches.
       *
       * It is the one feed here polled faster than a week, and it is the only
       * one whose runs do not repeat work: each reads municipalities the last
       * did not. Once the country is covered this keeps re-reading every parcel
       * twice a day, which is more than a land-use charter warrants; the cost
       * is about fifteen seconds of parsing a run and no writes where nothing
       * changed, so it is affordable rather than right, and the cadence should
       * come back to a week once the first pass is in.
       */
      cadenceSeconds: HOUR,
      timeoutSeconds: 600,
      // The worst group measured is 495 MiB; a fifth again on top of that.
      maxBytes: 640 * MEBIBYTE,
      // Stored rows are compact where the source is pretty-printed, so the
      // output of even the worst group is nearer 130 MiB than its 495.
      maxOutputBytes: 256 * MEBIBYTE,
      // The largest parcel boundary measured over 3,600 sampled is 749 KiB.
      maxRecordBytes: 1024 * 1024,
      maxRecords: 400_000,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
  },
  // Three days without a successful run is a feed that has stopped, not a slice
  // waiting its turn: this measures time since the last success, not data age.
  staleAfterSeconds: 6 * HOUR,
  /** Every hour: the next twenty-four municipalities' parcels of the crus layer, with their outlines, picking up where the last run's cursor stopped. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of those municipalities' parcel boundaries. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
