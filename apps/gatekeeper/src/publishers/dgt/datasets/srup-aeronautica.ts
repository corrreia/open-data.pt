import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Airport and aerodrome easements",
  description:
    "The 36 airports and aerodromes of mainland Portugal whose surroundings carry an aeronautical easement, each placed on the map with the ground its easement reaches, and with the decree that established it, its date, the municipalities it covers and a link to the act. The easement surfaces themselves are left at the source: four of the 36 run past the megabyte a record may hold.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "mobility"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-aeronautica-feed",
      collection: "srup_aeronautica",
      geometry: "point",
      features: 36,
      measured: { source: 40, output: 1, largestRow: 1 },
    }),
  ],
};
