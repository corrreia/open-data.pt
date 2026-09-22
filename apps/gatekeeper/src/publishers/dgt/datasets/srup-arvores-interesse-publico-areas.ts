import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Groves of public interest",
  description:
    "The 89 wooded areas classified as being of public interest in mainland Portugal, each with the ground it covers, the species, the act that classified it and the municipality it stands in.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["culture", "environment"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-arvores-interesse-publico-areas-feed",
      collection: "srup_arvores_areal",
      geometry: "include",
      features: 89,
      measured: { source: 1, output: 1, largestRow: 11 },
    }),
  ],
};
