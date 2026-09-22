import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Protection zones around public groundwater abstraction",
  description:
    "The 949 protection perimeters around groundwater abstracted for public supply in mainland Portugal, with the ordinance that set each one, its date and the municipality it lies in. Pampilhosa da Serra and Góis hold 155 between them, and each perimeter is drawn.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "health"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-captacoes-aguas-subterraneas-feed",
      collection: "srup_aquiferos",
      geometry: "include",
      features: 949,
      measured: { source: 11, output: 3, largestRow: 358 },
    }),
  ],
};
