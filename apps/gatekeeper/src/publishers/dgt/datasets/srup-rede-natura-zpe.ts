import type { DatasetDefinition } from "#/catalog/define";
import { srupFeed } from "#/publishers/dgt/ogc";

export const DATASET: DatasetDefinition = {
  title: "Natura 2000 Special Protection Areas",
  description:
    "The 44 Zonas de Proteção Especial for wild birds on the Portuguese mainland, with their outlines, the decree that designated each one, its date, the municipalities it covers and a link to the act.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-rede-natura-zpe-feed",
      collection: "srup_zpe",
      geometry: "include",
      properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio,dtccs",
      features: 44,
      measured: { source: 17, output: 4, largestRow: 729 },
    }),
  ],
};
