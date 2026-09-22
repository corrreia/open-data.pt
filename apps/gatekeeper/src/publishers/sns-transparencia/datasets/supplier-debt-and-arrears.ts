import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Health-service supplier debt and payment arrears",
  description: "Total external-supplier debt, overdue debt and payment arrears by region and institution, latest twenty-four reporting months, in euros.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-supplier-debt-and-arrears-feed", {
      dataset: "divida-total-vencida-e-pagamentos",
      timeField: "periodo",
      period: "month",
      windowPeriods: "24",
      orderBy: "periodo DESC,regiao,entidade",
      dimensions: "regiao,entidade",
      series: "divida_total_fornecedores_externos,divida_vencida_fornecedores_externos,pagamentos_em_atraso",
    }),
  ],
};
