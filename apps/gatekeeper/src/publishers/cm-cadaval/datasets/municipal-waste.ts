import type { DatasetDefinition } from "../../../catalog/define";
import { annualPolicy } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Cadaval municipal waste in 2024",
  description: "Monthly tonnes of municipal waste by material and collection route, published by Município do Cadaval for 2024.",
  licence: "cc-by-4.0",
  attribution: "Município do Cadaval",
  topics: ["cities", "environment"],
  feeds: [
    {
      slug: "cadaval-municipal-waste-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "producao-de-residuos-municipio-cadaval",
        distributionId: "33ebfc7e-7951-4170-9d76-d2ad5e8498a6",
        format: "csv",
        productSlug: "cadaval-municipal-waste",
        productTitle: "Cadaval municipal waste in 2024",
        feed: "distribution",
        transformer: "municipal-waste",
      },
      policy: annualPolicy("Cadaval waste annual snapshot", 256 * 1024),
      staleAfterSeconds: 30 * 86_400,
    },
  ],
};
