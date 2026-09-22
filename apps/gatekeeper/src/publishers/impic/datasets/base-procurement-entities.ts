import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, governmentFeed } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Public-procurement entities",
  description:
    "Entities in IMPIC's public-procurement registry, with source-published cumulative participation totals. Collected monthly as a large reference snapshot, not a live company-register lookup.",
  licence: "other-pd",
  attribution: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
  topics: ["government"],
  feeds: [
    governmentFeed({
      slug: "base-procurement-entities-feed",
      title: "Public-procurement entities",
      portalDataset: "67d80b2c4750b888116940fb",
      distributionId: "d85c49f0-b6ab-4cb7-afbe-4e103016b9a0",
      format: "json",
      keyField: "nifEntidade",
      cadenceSeconds: 30 * 86_400,
      maxBytes: 80 * MIB,
      maxOutputBytes: 160 * MIB,
    }),
  ],
};
