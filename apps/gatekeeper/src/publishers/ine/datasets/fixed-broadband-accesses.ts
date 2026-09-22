import type { DatasetDefinition } from "#/catalog/define";
import { annualLatest } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Fixed-location broadband accesses",
  description:
    "Latest annual number of fixed-location broadband accesses by NUTS 2024 geography, published through INE's telecommunications survey. These are accesses, not individual users or real-time availability.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society", "telecom"],
  feeds: [annualLatest("ine-fixed-broadband-accesses", "0013140")],
};
