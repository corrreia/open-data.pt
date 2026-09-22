import type { DatasetDefinition } from "#/catalog/define";
import { geo2Feed } from "#/publishers/dgt/wfs";

export const DATASET: DatasetDefinition = {
  title: "ReNEP permanent GNSS stations",
  description:
    "The 42 permanent GNSS stations of the Rede Nacional de Estações Permanentes, each with its four-letter code, its position and ellipsoidal height, who owns it, and the archive its RINEX observations are published to. Real-time positioning from these stations needs an account with DGT; the station register itself does not.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Nacional de Estações Permanentes (ReNEP)",
  topics: ["government", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-rgn-renep-estacoes-feed",
      workspace: "RGN",
      layer: "ReNEP",
      cadenceSeconds: 2_592_000,
      numberFields: "LATITUDE,LONGITUDE,ALTITUDE_E",
    }),
  ],
};
