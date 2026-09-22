import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Natura 2000 Special Areas of Conservation",
  description:
    "The 65 Zonas Especiais de Conservação of the Natura 2000 network on the Portuguese mainland, with their outlines, the phase of the national site list each belongs to, the decree that designated it, its date and the municipalities it covers.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-rede-natura-zec-feed",
      collection: "srup_zec",
      geometry: "include",
      features: 65,
      measured: { source: 53, output: 13, largestRow: 750 },
    }),
  ],
};
