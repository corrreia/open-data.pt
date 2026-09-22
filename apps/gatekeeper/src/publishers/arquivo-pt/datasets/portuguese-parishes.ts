import type { DatasetDefinition } from "#/catalog/define";
import { MIB, annualPolicy } from "#/formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portuguese parish websites",
  description: "Parish names, municipalities, districts, websites, and archived web histories compiled by Arquivo.pt in 2025.",
  licence: "cc-by-4.0",
  attribution: "Arquivo.pt",
  topics: ["cities"],
  feeds: [
    {
      slug: "portuguese-parishes-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "freguesias-de-portugal-websites-e-historico-de-versoes-no-arquivo-pt",
        distributionId: "8431fc10-6f5f-4096-80f6-27199f779660",
        format: "csv",
        productSlug: "portuguese-parish-websites",
        productTitle: "Portuguese parish websites",
        productDescription: "Parishes with municipality, district, current website, and Arquivo.pt history link.",
        keyField: "Nome, entidade, organização... (Títle 1)",
        feed: "distribution",
        transformer: "tabular",
      },
      policy: annualPolicy("Portuguese parishes annual snapshot", 2 * MIB),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
