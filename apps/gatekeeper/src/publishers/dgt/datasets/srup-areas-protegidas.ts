import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Protected areas as a public-utility restriction",
  description:
    "The 71 classified protected areas of mainland Portugal — national, natural and regional parks, nature reserves, natural monuments and protected landscapes — each placed on the map with the ground it covers, and with the decree that created it, its date, the municipalities it spans and a link to the act. Where each one lies and how far it reaches is published; the outline itself is not, because two of the seventy-one run past the megabyte a record may hold.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-areas-protegidas-feed",
      collection: "srup_areas_protegidas",
      geometry: "point",
      features: 71,
      measured: { source: 34, output: 1, largestRow: 1 },
    }),
  ],
};
