import type { DatasetDefinition } from "#/catalog/define";
import { CAOP_COLUMNS, CAOP_MUNICIPALITY_COLUMNS, geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "Madeira municipality boundaries (CAOP 2025)",
  description:
    "The 11 municipalities of the Autonomous Region of Madeira in the official administrative charter: the DTMN code, the island each belongs to, the three NUTS levels, the area in hectares, the perimeter and how many parishes each holds. Attributes only, without boundary outlines.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-caop-madeira-municipios-feed",
      workspace: "caop_ram",
      layer: "ram_municipios",
      propertyNames: CAOP_MUNICIPALITY_COLUMNS,
      cadenceSeconds: 604_800,
      numberFields: `${CAOP_COLUMNS},n_freguesias`,
    }),
  ],
};
