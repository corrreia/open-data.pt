import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Public health-sector contracts",
  description:
    "Health-sector procurement published in SNS Transparência's Portal BASE extract, latest sixty source publication days. Rows have provisional content-derived identities because this extract omits contract IDs; it is not the complete national BASE register.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
};
