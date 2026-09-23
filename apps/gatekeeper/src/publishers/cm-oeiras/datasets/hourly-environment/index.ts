import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Oeiras hourly air quality, noise and weather",
  description:
    "Hourly QART station measurements from the latest published monthly CSV. Monthly publication, not live observations; timestamps and units are those supplied by the municipality.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras via oeirasinterativa.oeiras.pt",
  topics: ["cities", "environment"],
};
