import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Railway stations and halts",
  description:
    "The 860 railway stations and halts of mainland Portugal held in the easement register, each where it stands, named and sorted into station, halt, or no longer worked — 298 of them are out of service. Lisbon holds 21. All 860 rest on the same 2003 decree, which the feed states once rather than on every row.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "mobility"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-estacoes-ferroviarias-feed",
      collection: "srup_rede_ferroviaria_estacoes",
      geometry: "include",
      properties: "designacao,tipologia,municipio,dtccs",
      features: 860,
      measured: { source: 11, output: 3, largestRow: 3 },
    }),
  ],
};
