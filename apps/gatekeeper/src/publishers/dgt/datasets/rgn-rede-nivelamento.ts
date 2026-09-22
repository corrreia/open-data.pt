import type { DatasetDefinition } from "../../../catalog/define";
import { geo2Feed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "National levelling network marks",
  description:
    "The 4,735 benchmarks of the national levelling network, each with its orthometric height above the Cascais datum, the levelling lines and sections it belongs to, and a written description of exactly where it is set — the doorstep of a citadel, the footing of a column.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Geodésica Nacional",
  topics: ["government", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-rgn-rede-nivelamento-feed",
      workspace: "RGN",
      layer: "RedeNivelamento",
      cadenceSeconds: 2_592_000,
    }),
  ],
};
