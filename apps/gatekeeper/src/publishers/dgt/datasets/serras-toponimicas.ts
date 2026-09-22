import type { DatasetDefinition } from "../../../catalog/define";
import { geo2Feed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Mountain ranges named in use",
  description:
    "The 395 mountain ranges of Portugal that carry a name in common use without being delimited as principal ranges — the toponymic layer of the same study, for names that appear on maps and in speech.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Contributos para a delimitação das serras de Portugal",
  topics: ["culture", "environment"],
  feeds: [
    geo2Feed({
      slug: "dgt-serras-toponimicas-feed",
      workspace: "serras_contributos",
      layer: "Serras_toponimicas",
      cadenceSeconds: 2_592_000,
    }),
  ],
};
