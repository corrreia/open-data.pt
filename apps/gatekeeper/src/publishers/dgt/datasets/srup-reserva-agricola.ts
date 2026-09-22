import type { DatasetDefinition } from "../../../catalog/define";
import { srupFeed } from "../ogc";

export const DATASET: DatasetDefinition = {
  title: "National Agricultural Reserve delimitations in force",
  description:
    "The Reserva Agrícola Nacional as delimited for each of 269 mainland municipalities, with the ordinance or notice that set it, the issue of the Diário da República it appeared in, the date it took effect and a link to the act. Attributes only: one delimitation covers its whole municipality and runs to eight megabytes of outline, so reading it would cost a gigabyte and a third a week to say where a municipality is.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  feeds: [
    srupFeed({
      slug: "dgt-srup-reserva-agricola-feed",
      collection: "srup_ran",
      properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio",
      features: 269,
      measured: { source: 1, output: 1, largestRow: 1 },
    }),
  ],
};
