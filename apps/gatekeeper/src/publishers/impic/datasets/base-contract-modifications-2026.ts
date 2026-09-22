import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, governmentFeed } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Public-contract modifications published in 2026",
  description:
    "Contract modifications in IMPIC's 2026 publication. The source has no distinct amendment identifier; repeated contract IDs use row-content identities rather than claiming a stable amendment ID.",
  licence: "other-pd",
  attribution: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
  topics: ["government"],
  feeds: [
    governmentFeed({
      slug: "base-contract-modifications-2026-feed",
      title: "Public-contract modifications published in 2026",
      portalDataset: "668d65dbcb1b953e80198435",
      distributionId: "d6d13c09-418e-443b-bbf4-b9bd77097571",
      format: "json",
      keyField: "idcontrato",
      eventTimeField: "modifDataPublicacao",
      cadenceSeconds: 604_800,
      maxBytes: 8 * MIB,
      maxOutputBytes: 32 * MIB,
    }),
  ],
};
