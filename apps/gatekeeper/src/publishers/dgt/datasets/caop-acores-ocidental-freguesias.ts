import type { DatasetDefinition } from "#/catalog/define";
import { CAOP_COLUMNS, CAOP_PARISH_COLUMNS, geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "Azores western parish boundaries (CAOP 2025)",
  description:
    "The 12 civil parishes of Flores and Corvo, the western island group of the Azores, in the official administrative charter: the DTMNFR code, the municipality and island each belongs to, the three NUTS levels, the area in hectares and the perimeter. Attributes only, without boundary outlines.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-caop-acores-ocidental-freguesias-feed",
      workspace: "caop_raa",
      layer: "raa_oci_freguesias",
      propertyNames: CAOP_PARISH_COLUMNS,
      cadenceSeconds: 604_800,
      numberFields: CAOP_COLUMNS,
    }),
  ],
};
