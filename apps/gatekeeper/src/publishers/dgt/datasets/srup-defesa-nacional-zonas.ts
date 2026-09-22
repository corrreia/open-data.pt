import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "National defence protection zones",
  description:
    "The 149 protection zones around military installations in mainland Portugal, each with the ground it covers, the act that established it, its date and the municipality it lies in.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-defesa-nacional-zonas-feed",
      collection: "srup_defesa_militar_zonas",
      geometry: "include",
      features: 149,
      measured: { source: 6, output: 1, largestRow: 378 },
    }),
  ],
};
