import type { DatasetDefinition } from "../../../catalog/define";
import { geo2Feed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "National geodetic network vertices",
  description:
    "The 7,968 vertices of the Rede Geodésica Nacional, where each one stands and what it is worth as a control point: the name it is known by, the 1:50,000 sheet it falls on, the order of the network it belongs to, its topographic height, its PT-TM06 coordinates and whether those were observed or transformed. This is the survey register; the same marks appear in the easement register with the municipality each stands in and nothing about their height.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Geodésica Nacional",
  topics: ["government", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-rgn-vertices-geodesicos-feed",
      workspace: "RGN",
      layer: "VG",
      // The network is resurveyed over years. Monthly is often enough to notice a
      // vertex being added or retired, and costs the service one read a month.
      cadenceSeconds: 2_592_000,
      numberFields: "M,P",
    }),
  ],
};
