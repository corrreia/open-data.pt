import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_WEEKLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-municipal-tariff-consumption-feed",
  title: "Municipal electricity consumption by tariff period",
  description:
    "Billed active energy in the source's six tariff-period categories, summed across parishes for every E-REDES municipality, latest six reporting months. The overall energy total is not repeated.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  config: {
    host: E_REDES_HOST,
    limit: "10000",
    dataset: "consumos-faturados-por-periodo-tarifario",
    timeField: "data",
    period: "month",
    windowPeriods: "6",
    select:
      "data,con_code,sum(energia_ativa_simples_kwh) as energia_ativa_simples_kwh,sum(energia_ativa_vazio_kwh) as energia_ativa_vazio_kwh,sum(energia_ativa_fora_de_vazio_kwh) as energia_ativa_fora_de_vazio_kwh,sum(energia_ativa_super_vazio_kwh) as energia_ativa_super_vazio_kwh,sum(energia_ativa_ponta_kwh) as energia_ativa_ponta_kwh,sum(energia_ativa_cheias_kwh) as energia_ativa_cheias_kwh",
    groupBy: "data,con_code",
    orderBy: "data DESC,con_code",
    dimensions: "con_code",
    series: "energia_ativa_simples_kwh,energia_ativa_vazio_kwh,energia_ativa_fora_de_vazio_kwh,energia_ativa_super_vazio_kwh,energia_ativa_ponta_kwh,energia_ativa_cheias_kwh",
  },
  policy: E_REDES_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 6 months of E-REDES's `consumos-faturados-por-periodo-tarifario` dataset, by `data`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `consumos-faturados-por-periodo-tarifario` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 6 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
