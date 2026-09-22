import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "National defence easements",
  description:
    "The 152 military installations of mainland Portugal carrying a defence easement — barracks, forts and batteries — each with the ground it occupies, the act that established it, its date and the municipality it stands in. Lisbon holds 20.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-defesa-nacional-feed",
      collection: "srup_defesa_militar",
      geometry: "include",
      features: 152,
      measured: { source: 6, output: 1, largestRow: 725 },
    }),
  ],
};
