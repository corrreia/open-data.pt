import type { DatasetDefinition } from "../../../catalog/define";
import { mafraFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Mafra recycling points",
  description:
    "Recycling points in Mafra, each naming the containers standing there for paper, packaging, glass, batteries, refuse, bio-waste, oil and textiles, with its street, locality and parish.",
  licence: "source-terms",
  attribution: "Município de Mafra — Dados Abertos",
  topics: ["cities", "environment"],
  feeds: [
    mafraFeed({ slug: "mafra-ecopontos-contentores-feed", service: "DadosAbertos_Amb_Ecopontos_Contentores", layer: "1" }),
    // Layer 2 of that same service holds the 8,635 containers themselves, one record each with
    // capacity and state of conservation, and is the richer half of the pair. It is a table
    // rather than a feature layer, and this library reads layers: it requires a geometry type
    // and a table declares none. Read it once tables are supported, not by pretending it has one.
  ],
};
