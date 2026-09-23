import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Monthly electricity consumption by municipality and voltage",
  description:
    "E-REDES billed active energy, summed by the source from parish rows into municipality and voltage-level totals. All published municipalities, latest twelve reporting months; Includes source-suppressed OUTROS district groups rather than attributing them to a municipality; not island consumption outside E-REDES coverage.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
