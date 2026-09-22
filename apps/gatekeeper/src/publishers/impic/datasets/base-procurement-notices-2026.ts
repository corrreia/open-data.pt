import type { DatasetDefinition } from "#/catalog/define";
import { MIB, governmentFeed } from "#/formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Public-procurement notices published in 2026",
  description:
    "IMPIC's 2026 procurement notices, including contracting authorities, base prices, procedures, deadlines and source links. One current record per notice; not a duplicate of signed contracts.",
  licence: "other-pd",
  attribution: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
  topics: ["government"],
  feeds: [
    governmentFeed({
      slug: "base-procurement-notices-2026-feed",
      title: "Public-procurement notices published in 2026",
      portalDataset: "66d72fbc58cd7a63dae28712",
      distributionId: "1002987e-8985-492f-9215-e732fffdbc83",
      format: "json",
      keyField: "nAnuncio",
      eventTimeField: "dataPublicacao",
      cadenceSeconds: 604_800,
      maxBytes: 48 * MIB,
      maxOutputBytes: 96 * MIB,
    }),
  ],
};
