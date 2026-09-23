import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Transportes Colectivos do Barreiro GTFS",
  description:
    "Stops, routes, agencies and service days, with route shapes, from Transportes Colectivos do Barreiro's current static schedule archive. Not live service or delay information.",
  licence: "cc-by-4.0",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
};
