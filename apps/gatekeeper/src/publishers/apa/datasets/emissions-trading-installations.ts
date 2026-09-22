import type { DatasetDefinition } from "../../../catalog/define";
import { apaFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Installations in the EU emissions trading system",
  description: "Portuguese installations covered by the EU greenhouse gas emissions trading system.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [apaFeed({ slug: "apa-emissions-trading-installations-feed", service: "CELE" })],
};
