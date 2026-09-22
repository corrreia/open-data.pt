import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "National Ecological Reserve watercourse delimitations",
  description:
    "The 138 linear delimitations of the Reserva Ecológica Nacional — watercourses and the ten-metre beds either side of them — with the act that set each one, its date and the municipality it covers. Attributes only, for the same reason as the areas: a delimitation spans its whole municipality.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-reserva-ecologica-linhas-feed",
      collection: "srup_ren_linear",
      features: 138,
      measured: { source: 1, output: 1, largestRow: 1 },
    }),
  ],
};
