import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-national-production-feed",
  config: { host: E_REDES_HOST, dataset: "energia-produzida-total-nacional", orderBy: "datahora DESC", limit: "1000", series: "total,dgm,pre" },
  policy: {
    name: "Opendatasoft daily series subset",
    version: 1,
    collection: {
      cadenceSeconds: 21_600,
      timeoutSeconds: 180,
      maxBytes: 8 * 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 172_800,
  /** Every six hours: E-REDES's `energia-produzida-total-nacional` dataset, up to 1000 records ordered by `datahora DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `energia-produzida-total-nacional` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 3 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
