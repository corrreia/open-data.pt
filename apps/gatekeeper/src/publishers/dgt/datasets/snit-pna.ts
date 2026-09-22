import type { DatasetDefinition } from "../../../catalog/define";
import { snitFeed } from "../snit/feeds";

export const DATASET: DatasetDefinition = {
  title: "National water plan",
  description:
    "The national plan for the country's water, above the river basin plans. Every Plano Nacional da Água (PNA) the national register holds as being in force — 1 of them at the last reading — with the municipalities it covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, what it changed, its deposit reference and a link to the act itself.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
  topics: ["environment", "government"],
  feeds: [snitFeed({ type: "pna" })],
};
