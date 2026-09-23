import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Fertagus GTFS",
  description: "Stops, routes, agencies and service days, with route shapes, from Fertagus's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
};
