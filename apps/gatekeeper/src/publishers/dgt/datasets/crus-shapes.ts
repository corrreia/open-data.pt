import type { DatasetDefinition } from "#/catalog/define";
import type { CollectionPolicyDefinition } from "#/index";
import { HOUR, MEBIBYTE } from "#/formats/ogc/feeds";
import { CRUS_COLUMNS, DGT_HOST } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Mainland Portugal land-use regime: parcel boundaries (CRUS)",
  description:
    "The boundary of every parcel in the Carta do Regime de Uso do Solo, with the class and category of soil its municipal plan puts it in. Read a few municipalities at a time and built up into one national layer, because the whole of it is 4.7 GiB of coordinates. Each boundary carries the same parcel identifier as the land-use table, so the two join on it: this feed says where a parcel is, and that one says whether it is still in force.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta do Regime de Uso do Solo",
  topics: ["cities", "government"],
  feeds: [
    /*
     * The same charter, with the outlines this time.
     *
     * Every parcel's boundary comes to 4.7 GiB and a quarter of an hour of
     * streaming, from a service that loses a connection every few minutes — one
     * sitting will not do it. So it is read a few municipalities a run, each one
     * twenty-two megabytes and a few seconds, and the runs pile up into a single
     * dataset: the kernel merges a partial snapshot into what is already served
     * rather than replacing it.
     *
     * Which municipalities exist is read from the administrative charter's own
     * codes rather than written down here, and `dtcc` on a parcel is that same
     * code — checked against Lisboa, 1106 either side. Sharding on the code rather
     * than the name also steps around the layer spelling Constância with an Ã.
     *
     * A partial snapshot cannot say a parcel is gone. What can is `dgt-crus-feed`,
     * which reads every row of the same collection without outlines, finishes in
     * one sitting, and is authoritative when it does: a shape whose parcel is no
     * longer in that table is a shape nothing references.
     */
    {
      slug: "dgt-crus-shapes-feed",
      config: {
        source: "ogc",
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
    },
  ],
};
