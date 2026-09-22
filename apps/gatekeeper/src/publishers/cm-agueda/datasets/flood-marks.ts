import type { DatasetDefinition } from "#/catalog/define";
import { aguedaFeed } from "#/publishers/cm-agueda/ckan";

export const DATASET: DatasetDefinition = {
  title: "Águeda flood-level reference marks",
  description: "Surveyed flood-height reference marks, not current river levels or flood warnings.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt",
  topics: ["cities", "environment"],
  feeds: [aguedaFeed("flood-marks", "cotas-de-cheia", "51ebb54b-0249-46b6-8aa9-edf5365a9976", { idField: "gid", crs: "EPSG:3763" })],
};
