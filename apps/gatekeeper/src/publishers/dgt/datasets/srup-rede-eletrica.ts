import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Electricity grid easements",
  description:
    "The 2,456 stretches of the national electricity grid carrying an easement in mainland Portugal, each drawn as it runs, sorted by voltage, with the decree behind it and the municipality it crosses.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["energy", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-rede-eletrica-feed",
      collection: "srup_rede_eletrica",
      geometry: "include",
      features: 2456,
      measured: { source: 43, output: 11, largestRow: 64 },
    }),
  ],
};
