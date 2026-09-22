import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras parking meters",
  description: "Parking meters in Oeiras with their tariff, zone and sub-zone, street, parish, whether a weekly price applies, and the date each was surveyed.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "mobility"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-parquimetros-feed",
      layer: "w_parquimetros",
      dateOnlyFields: "data_levantamento",
    }),
  ],
};
