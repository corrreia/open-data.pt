import type { DatasetDefinition } from "#/catalog/define";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Municipal availability of electric-vehicle charging",
  description: "2023 indicator showing whether each Portuguese municipality provided and located electric-vehicle charging points, published by ARTE.",
  licence: "cc-by-4.0",
  attribution: "Agência para a Reforma Tecnológica do Estado",
  topics: ["cities", "energy"],
  feeds: [
    {
      slug: "municipal-ev-charging-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "enti-indicador-disponibilizacao-e-localizacao-de-postos-de-carregamento-de-veiculos-eletricos",
        distributionId: "309bfd1f-bdb6-442e-9fdd-b9ce41424d40",
        format: "csv",
        productSlug: "municipal-ev-charging-availability",
        productTitle: "Municipal availability of electric-vehicle charging",
        productDescription: "Municipality-level availability of public electric-vehicle charging locations in 2023.",
        eventTimeField: "ano",
        feed: "distribution",
        transformer: "tabular",
      },
      policy: annualPolicy("Municipal EV charging annual snapshot", 1 * MIB),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
