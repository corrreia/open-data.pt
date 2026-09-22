import type { DatasetDefinition } from "#/catalog/define";
import { annualLatest } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Fixed broadband accesses per 100 inhabitants by technology",
  description:
    "Latest annual fixed-location broadband access rate by NUTS 2024 geography and access technology. This measures subscription penetration, not network coverage or customer outages.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society", "telecom"],
  feeds: [annualLatest("ine-fixed-broadband-accesses-per-100", "0013424")],
};
