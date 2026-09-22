import type { DatasetDefinition } from "#/catalog/define";
import { snitFeed } from "#/publishers/dgt/snit/feeds";

export const DATASET: DatasetDefinition = {
  title: "Coastal zone plans",
  description:
    "The older plan tier for the shoreline, still in force where no programme has replaced it. Every Plano de Ordenamento da Orla Costeira (POOC) the national register holds as being in force — 5 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["environment", "government"],
  feeds: [snitFeed({ type: "pooc" })],
};
