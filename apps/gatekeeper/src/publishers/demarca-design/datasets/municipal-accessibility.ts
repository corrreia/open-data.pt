import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, annualPolicy } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Municipal digital accessibility",
  description: "Accessibility measurements for Portuguese municipal websites, published by DEMARCA Design in 2026.",
  licence: "cc-by-4.0",
  attribution: "DEMARCA Design",
  topics: ["cities"],
  feeds: [
    {
      slug: "municipal-accessibility-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "acessibilidade-digital-nos-municipios-portugueses-1-a-edicao-2026",
        distributionId: "c03ae2c2-9c33-4c6f-9d1a-bb813088d6e6",
        format: "csv",
        productSlug: "municipal-accessibility",
        productTitle: "Municipal digital accessibility",
        keyField: "entidade",
        feed: "distribution",
        transformer: "municipal-accessibility",
      },
      policy: annualPolicy("Municipal accessibility annual snapshot", 2 * MIB),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
