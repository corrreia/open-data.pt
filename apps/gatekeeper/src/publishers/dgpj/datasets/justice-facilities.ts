import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, annualPolicy } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portuguese justice facilities",
  description: "Courts and other justice facilities with addresses and coordinates, published by the Directorate-General for Justice Policy.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral da Política de Justiça",
  topics: ["society"],
  feeds: [
    {
      slug: "justice-facilities-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "justica-no-mapa",
        distributionId: "3d951837-9cae-4474-8b5b-e5934b9a93e8",
        format: "csv",
        productSlug: "justice-facilities",
        productTitle: "Portuguese justice facilities",
        productDescription: "Justice facilities with contact details and map coordinates.",
        keyField: "Nome",
        feed: "distribution",
        transformer: "tabular",
      },
      policy: annualPolicy("Justice facilities annual snapshot", 1 * MIB),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
