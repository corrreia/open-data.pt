import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais allotments",
  description: "The Terras de Cascais allotments, where residents are given ground to cultivate.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment"],
  feeds: [cascaisFeed("cascais-allotments-feed", "geocascais-horta", "67f6aa56-49b2-4d15-b81c-825d449acb9c")],
};
