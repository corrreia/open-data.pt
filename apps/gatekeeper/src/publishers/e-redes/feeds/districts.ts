import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-districts-feed",
  title: "Portuguese districts",
  description: "E-REDES district boundaries and representative points for Portugal.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: { host: E_REDES_HOST, dataset: "districts-portugal", orderBy: "dis_code", limit: "100" },
  policy: {
    name: "Opendatasoft reference snapshot",
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 180,
      maxBytes: 8 * 1024 * 1024,
      maxOutputBytes: 32 * 1024 * 1024,
      maxRecordBytes: 2 * 1024 * 1024,
      maxRecords: 20_000,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 172_800,
  /** Once a day: E-REDES's `districts-portugal` dataset, up to 100 records ordered by `dis_code`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `districts-portugal` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
