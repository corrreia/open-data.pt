import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Medical specialty training vacancies",
  description:
    "Available, filled and unfilled medical-internship specialty training places, latest three reporting years, preserved as records using the publisher's unique registo IDs. Some historical records share year, region, institution and specialty but report different counts without a cohort or revision label; these remain separate records rather than arbitrarily selected or summed series points.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
};
