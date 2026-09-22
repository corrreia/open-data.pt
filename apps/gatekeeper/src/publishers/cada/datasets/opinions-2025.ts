import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, governmentFeed } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "CADA administrative-document access opinions for 2025",
  description: "Opinions on access to administrative documents issued in 2025. This is a historical annual publication, not a live legal feed.",
  licence: "cc-by-4.0",
  attribution: "CADA · Comissão de Acesso aos Documentos Administrativos",
  topics: ["government"],
  feeds: [
    governmentFeed({
      slug: "cada-opinions-2025-feed",
      title: "CADA administrative-document access opinions for 2025",
      portalDataset: "6a886960e18b67254bb6b93b",
      distributionId: "e10e5071-90ea-42cc-aea3-8710222339ba",
      format: "csv",
      keyField: "N.º Parecer",
      eventTimeField: "Data Parecer",
      cadenceSeconds: 30 * 86_400,
      maxBytes: 2 * MIB,
      maxOutputBytes: 8 * MIB,
    }),
  ],
};
