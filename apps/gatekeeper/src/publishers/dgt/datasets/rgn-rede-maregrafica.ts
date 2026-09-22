import type { DatasetDefinition } from "../../../catalog/define";
import { geo2Feed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "National tide gauge network",
  description:
    "The two tide gauges of the national network, at Cascais and Lagos, with the height of each one's reference mark and the archive its records are published to. The Cascais gauge is the origin of the height datum every orthometric height in Portugal is measured from.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Geodésica Nacional",
  topics: ["environment", "government"],
  feeds: [
    geo2Feed({
      slug: "dgt-rgn-rede-maregrafica-feed",
      workspace: "RGN",
      layer: "RedeMaregrafica",
      cadenceSeconds: 2_592_000,
    }),
  ],
};
