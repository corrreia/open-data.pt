import type { DatasetDefinition } from "../../../catalog/define";
import { energy } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Municipal electricity consumption by tariff period",
  description:
    "Billed active energy in the source's six tariff-period categories, summed across parishes for every E-REDES municipality, latest six reporting months. The overall energy total is not repeated.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy("e-redes-municipal-tariff-consumption-feed", {
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
    }),
  ],
};
