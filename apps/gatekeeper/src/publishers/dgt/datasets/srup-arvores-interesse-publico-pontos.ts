import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Trees of public interest",
  description:
    "The 551 individual trees and groves classified as being of public interest in mainland Portugal, where each one stands, its species, whether it is a single tree or a group, and the notice that classified it. Lisbon holds 84 of them and Marinha Grande 34; the oldest classification here dates from 1947.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["culture", "environment"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-arvores-interesse-publico-pontos-feed",
      collection: "srup_arvores_point",
      geometry: "include",
      features: 551,
      measured: { source: 1, output: 1, largestRow: 1 },
    }),
  ],
};
