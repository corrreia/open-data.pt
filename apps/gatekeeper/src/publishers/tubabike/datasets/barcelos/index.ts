import type { DatasetDefinition } from "#/catalog/define";

/*
 * TubaBike is the one system here that fills GBFS's own licence field —
 * `"license_id": "CC0-1.0"` in its `system_information.json` — which is why its
 * feeds are collected under policies of their own.
 */
export const DATASET: DatasetDefinition = {
  title: "TubaBike bicycles and station availability in Barcelos",
  description: "Current TubaBike bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
  licence: "cc0-1.0",
  attribution: "TubaBike — Mobilidade de Barcelos",
  topics: ["mobility"],
};
