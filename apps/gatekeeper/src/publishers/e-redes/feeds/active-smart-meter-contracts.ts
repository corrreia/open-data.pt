import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-active-smart-meter-contracts-feed",
  title: "Active electricity contracts by meter type and district",
  description:
    "Active delivery-point contracts with and without smart meters, summed by E-REDES from parish rows into district totals. All districts in its service area, latest twelve reporting months; inactive contracts excluded.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    limit: "10000",
    dataset: "21-contadores-de-energia",
    timeField: "data",
    period: "month",
    windowPeriods: "12",
    where: "contrato_ativo = 'Sim'",
    select: "data,coddistrito,distrito,inclui_emi,sum(cpes) as cpes",
    groupBy: "data,coddistrito,distrito,inclui_emi",
    orderBy: "data DESC,coddistrito,distrito,inclui_emi",
    dimensions: "coddistrito,distrito,inclui_emi",
    series: "cpes",
    units: "cpes=delivery points",
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 12 months of E-REDES's `21-contadores-de-energia` dataset, by `data`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `21-contadores-de-energia` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `cpes`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
