import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "National Ecological Reserve delimitations in force",
  description:
    "Every municipal delimitation of the Reserva Ecológica Nacional in force on the Portuguese mainland — 399 of them, each an ordinance or notice with the municipality it covers, the area it protects in hectares, whether it is the reserve itself or an exclusion from it, and a link to the act in the Diário da República. Attributes only: each delimitation is drawn across a whole municipality, so the ground it reaches is the municipality, which the charter already publishes.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-reserva-ecologica-areas-feed",
      collection: "srup_ren_areal",
      features: 399,
      measured: { source: 1, output: 1, largestRow: 1 },
    }),
  ],
};
