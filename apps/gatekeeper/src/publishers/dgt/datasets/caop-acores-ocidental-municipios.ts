import type { DatasetDefinition } from "#/catalog/define";
import { CAOP_COLUMNS, CAOP_MUNICIPALITY_COLUMNS, geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "Azores western municipality boundaries (CAOP 2025)",
  description:
    "The 3 municipalities of the western island group of the Azores — Flores and Corvo — in the official administrative charter: the DTMN code, the island, the three NUTS levels, the area in hectares, the perimeter and the parish count. Attributes only, without boundary outlines.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-caop-acores-ocidental-municipios-feed",
      workspace: "caop_raa",
      layer: "raa_oci_municipios",
      propertyNames: CAOP_MUNICIPALITY_COLUMNS,
      cadenceSeconds: 604_800,
      numberFields: `${CAOP_COLUMNS},n_freguesias`,
    }),
  ],
};
