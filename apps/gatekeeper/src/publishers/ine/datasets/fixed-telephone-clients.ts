import type { DatasetDefinition } from "../../../catalog/define";
import { annualLatest } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Fixed-telephone service clients",
  description: "Latest annual number of direct-access fixed-telephone service clients by access segment, from INE's telecommunications survey.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society", "telecom"],
  feeds: [annualLatest("ine-fixed-telephone-clients", "0006851")],
};
