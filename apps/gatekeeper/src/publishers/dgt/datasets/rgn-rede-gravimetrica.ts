import type { DatasetDefinition } from "#/catalog/define";
import { geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "National gravimetric network stations",
  description: "The 6,584 stations of the national gravimetric network, where each one stands and the measurements recorded for it.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Geodésica Nacional",
  topics: ["government", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-rgn-rede-gravimetrica-feed",
      workspace: "RGN",
      layer: "RedeGravimetrica",
      cadenceSeconds: 2_592_000,
    }),
  ],
};
