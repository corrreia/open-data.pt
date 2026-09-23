import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Public-contract modifications published in 2026",
  description:
    "Contract modifications in IMPIC's 2026 publication. The source has no distinct amendment identifier; repeated contract IDs use row-content identities rather than claiming a stable amendment ID.",
  licence: "other-pd",
  attribution: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
  topics: ["government"],
};
