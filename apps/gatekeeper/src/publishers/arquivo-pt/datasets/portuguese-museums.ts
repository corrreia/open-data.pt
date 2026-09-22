import type { DatasetDefinition } from "#/catalog/define";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Museums and museum centres in Portugal",
  description: "Museum names, locations, websites, and archived web histories compiled by Arquivo.pt in 2026.",
  licence: "cc-by-4.0",
  attribution: "Arquivo.pt",
  topics: ["culture", "society"],
  feeds: [
    {
      slug: "portuguese-museums-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "museus-em-portugal-websites-e-historico-preservado-no-arquivo-pt",
        distributionId: "5cdbe7e5-38a6-481b-9542-2637fe7ed3cc",
        format: "csv",
        productSlug: "portuguese-museums",
        productTitle: "Museums and museum centres in Portugal",
        productDescription: "Museums and museum centres with municipality, district, website, and archived history links.",
        keyField: "Nome, entidade, organização... (Títle 1)",
        feed: "distribution",
        transformer: "tabular",
      },
      policy: annualPolicy("Portuguese museums annual snapshot", 1 * MIB),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
