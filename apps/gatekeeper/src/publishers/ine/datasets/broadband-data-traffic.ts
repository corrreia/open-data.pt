import type { DatasetDefinition } from "../../../catalog/define";
import { annualLatest } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Broadband internet data traffic by network type",
  description:
    "Latest annual broadband internet traffic in gigabytes by network type, from INE's telecommunications survey. Traffic volume is not connection speed or outage information.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society", "telecom"],
  feeds: [annualLatest("ine-broadband-data-traffic", "0006868")],
};
