import type { DatasetDefinition } from "#/catalog/define";
import { geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "Portugal's principal mountain ranges",
  description:
    "The 588 principal mountain ranges of Portugal as DGT delimits them, each with the name it goes by, its alignment, its highest and mean altitude, its height above the land around it, its length, width, area and perimeter, the rock that dominates it, the morphostructural and geomorphological units it belongs to, and how it rates for size and altimetric vigour. Attributes only: the 588 outlines come to eleven megabytes, more than one read of this service may carry.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Contributos para a delimitação das serras de Portugal",
  topics: ["culture", "environment"],
  feeds: [
    geo2Feed({
      slug: "dgt-serras-principais-feed",
      workspace: "serras_contributos",
      layer: "Serras_principais",
      // The service also holds a ruggedness rating, in a column whose name carries
      // an accent; a property list is ASCII, so naming the rest leaves that one behind.
      propertyNames: "Serra,_Nome,_OutroNome,Alinhament,Maiores,Alt_max,Alt_media,Altura,Compto_km,Largura_m,Area_km2,Perimet_km,RochaDomin,UnidadeME,GU,Grandeza,VigorAltim",
      // A gazetteer, revised when the study behind it is: monthly is generous.
      cadenceSeconds: 2_592_000,
      numberFields: "Alt_max,Alt_media,Altura,Compto_km,Area_km2,Perimet_km,Largura_m",
    }),
  ],
};
