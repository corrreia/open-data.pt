import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "Railway easements",
  description:
    "The 502 stretches of railway in mainland Portugal carrying an easement, each drawn as it runs, with the act that established it, its date and the municipality it crosses.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "mobility"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-rede-ferroviaria-feed",
      collection: "srup_rede_ferroviaria",
      geometry: "include",
      features: 502,
      measured: { source: 57, output: 14, largestRow: 338 },
    }),
  ],
};
