import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Rural fire management points",
  description:
    "The 7,841 points held in the sub-regional rural fire management programmes of mainland Portugal: 7,550 water points for firefighting, 172 lookout and detection posts, and the rest strategic fuel-break mosaics. Each carries the intermunicipal body that answers for it, the programme it belongs to and the notice that approved that programme.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-sgifr-pontos-feed",
      collection: "sgifr_pontos",
      geometry: "include",
      features: 7841,
      measured: { source: 7, output: 4, largestRow: 1 },
    }),
  ],
};
