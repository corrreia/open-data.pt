import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, annualPolicy } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portuguese public library statistics for 2024",
  description: "Population, collections, visits, loans, activities, staffing, and services reported by public libraries for 2024.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Livro, dos Arquivos e das Bibliotecas",
  topics: ["culture", "society"],
  feeds: [
    {
      slug: "public-libraries-2024-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "dados-estatisticos-da-rede-nacional-de-bibliotecas-publicas-2024",
        distributionId: "00f3876f-dfe4-47a1-9f53-e06de3e275a2",
        format: "csv",
        productSlug: "public-library-statistics-2024",
        productTitle: "Portuguese public library statistics for 2024",
        productDescription: "One record per reporting library, with typed population, collection, use, staffing, and service measures.",
        headerRow: "3",
        feed: "distribution",
        transformer: "tabular",
      },
      policy: annualPolicy("Public libraries annual snapshot", 1 * MIB),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
