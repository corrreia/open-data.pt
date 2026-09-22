import type { DatasetDefinition } from "#/catalog/define";
import { CAOP_COLUMNS, CAOP_PARISH_COLUMNS, geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "Azores central and eastern parish boundaries (CAOP 2025)",
  description:
    "The 144 civil parishes of the central and eastern island groups of the Azores in the official administrative charter: the DTMNFR code, the municipality and island each belongs to, the three NUTS levels, the area in hectares and the perimeter. Attributes only, without boundary outlines.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-caop-acores-central-oriental-freguesias-feed",
      workspace: "caop_raa",
      layer: "raa_cen_ori_freguesias",
      propertyNames: CAOP_PARISH_COLUMNS,
      cadenceSeconds: 604_800,
      numberFields: CAOP_COLUMNS,
    }),
  ],
};
