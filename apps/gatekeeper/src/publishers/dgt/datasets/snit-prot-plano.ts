import type { DatasetDefinition } from "../../../catalog/define";
import { snitFeed } from "../snit/feeds";

export const DATASET: DatasetDefinition = {
  title: "Regional spatial plans",
  description:
    "The older regional tier, still in force where the programme that replaces it has not yet been published. Every Plano Regional de Ordenamento do Território (PROT) the national register holds as being in force — 6 of them at the last reading — with the municipalities each of them covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["government"],
  feeds: [snitFeed({ type: "prot-plano" })],
};
