import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Classified public water reservoirs",
  description:
    "The 192 classified reservoirs of mainland Portugal, each placed on the map with the water it holds, sorted into protected, conditioned and freely used, with the ordinance that classified it and the municipalities around it. The outlines are left at the source: fifteen of the 192 run past the megabyte a record may hold.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["energy", "environment"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-albufeiras-feed",
      collection: "srup_albufeiras",
      geometry: "point",
      features: 192,
      measured: { source: 253, output: 1, largestRow: 1 },
    }),
  ],
};
