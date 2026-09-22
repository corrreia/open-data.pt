import type { DatasetDefinition } from "#/catalog/define";
import { lisbonFeed } from "#/publishers/cm-lisboa/arcgis";
import { arcgisReferencePolicy } from "#/formats/arcgis/feeds";

export const DATASET: DatasetDefinition = {
  title: "Lisbon signalised crossings",
  description: "Locations and boundaries of road crossings controlled by traffic lights in Lisbon.",
  licence: "odc-pddl",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
  feeds: [
    lisbonFeed({
      slug: "lisbon-signalised-crossings-feed",
      service: "CruzamentosSemaforizados",
      layer: "0",
      policy: arcgisReferencePolicy("ArcGIS daily reference layer, dedicated"),
    }),
  ],
};
