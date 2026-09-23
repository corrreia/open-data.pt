import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "STCP bus positions",
  description: "Where each STCP bus in service is now, with its heading, speed, the route it is running and the trip it is on, dated by the clock of the vehicle that reported it.",
  licence: "cc0-1.0",
  attribution: "STCP — Urban Platform",
  topics: ["cities", "mobility"],
};
