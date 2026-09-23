import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Metropolitano de Lisboa network",
  description:
    "The Lisbon metro's stations, its scheduled headways, and how each line is running right now. Its GTFS timetable is redistributed through dados.gov.pt under different terms, so it is its own dataset.",
  licence: "metrolisboa-api",
  attribution: "Metropolitano de Lisboa",
  topics: ["mobility"],
};
