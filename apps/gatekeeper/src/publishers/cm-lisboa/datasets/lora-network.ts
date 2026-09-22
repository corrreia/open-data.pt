import type { DatasetDefinition } from "#/catalog/define";
import { lisbonFeed } from "#/publishers/cm-lisboa/arcgis";

export const DATASET: DatasetDefinition = {
  title: "Lisbon LoRa network sites",
  description: "Locations of municipal LoRa network sites in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [lisbonFeed({ slug: "lisbon-lora-network-feed", service: "Rede_LoRa", layer: "0" })],
};
