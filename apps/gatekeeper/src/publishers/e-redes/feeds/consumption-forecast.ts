import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_QUARTER_HOUR_SERIES } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-consumption-forecast-feed",
  title: "Electricity consumption forecast",
  description: "E-REDES 15-minute consumption forecast by voltage level, from the past day to seven days ahead.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    dataset: "previsao-de-consumo",
    where: "datahora >= now(days=-1) AND datahora < now(days=8)",
    orderBy: "datahora",
    limit: "1000",
    series: "total,bt,mt,at,mat",
  },
  policy: E_REDES_QUARTER_HOUR_SERIES,
  staleAfterSeconds: 172_800,
  /** Every six hours: E-REDES's `previsao-de-consumo` dataset, up to 1000 records ordered by `datahora`, filtered at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `previsao-de-consumo` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 5 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
