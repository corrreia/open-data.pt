import type { DatasetDefinition } from "../../../catalog/define";
import { snitFeed } from "../snit/feeds";

export const DATASET: DatasetDefinition = {
  title: "Regional forest programmes",
  description:
    "The regional programmes setting what the forest of each region is managed for. Every Programa Regional de Ordenamento Florestal (PROF) the national register holds as being in force — 7 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["environment", "government"],
  feeds: [snitFeed({ type: "prof" })],
};
