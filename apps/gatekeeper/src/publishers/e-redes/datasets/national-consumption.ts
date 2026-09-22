import type { DatasetDefinition } from "#/catalog/define";
import { E_REDES_QUARTER_HOUR_SERIES, eRedes } from "#/publishers/e-redes/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "National electricity consumption",
  description: "The latest 15-minute national electricity consumption by voltage level, published by E-REDES.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    eRedes(
      "e-redes-national-consumption-feed",
      { portalDataset: "consumo-total-nacional", orderBy: "datahora DESC", limit: "1000", series: "total,bt,mt,at,mat" },
      E_REDES_QUARTER_HOUR_SERIES,
      172_800,
    ),
  ],
};
