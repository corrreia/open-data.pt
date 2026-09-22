import type { DatasetDefinition } from "#/catalog/define";
import { snsDaily } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Patients waiting for continuing-care places",
  description: "Daily count of patients waiting for a place in the national continuing-care network, by region and care type.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [snsDaily("sns-continuing-care-waiting-feed", "rncci-episodios", "data DESC,regiao,tipologia", "5000", "episodios")],
};
