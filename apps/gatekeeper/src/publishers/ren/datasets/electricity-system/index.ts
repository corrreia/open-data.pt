import type { DatasetDefinition } from "#/catalog/define";

// The consumption service reads the same chart as production-breakdown, whose Consumption series already publishes these numbers, so it has no feed.
export const DATASET: DatasetDefinition = {
  title: "REN electricity system",
  description: "How Portugal's electricity is generated, what share is renewable, what crosses the border, and what capacity is installed.",
  licence: "ren-datahub",
  attribution: "REN — Redes Energéticas Nacionais",
  topics: ["energy"],
};
