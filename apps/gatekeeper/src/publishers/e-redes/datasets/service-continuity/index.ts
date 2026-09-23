import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Electricity service continuity by municipality",
  description:
    "Annual SAIFI, SAIDI, MAIFI, TIEPI and energy-not-distributed indicators for all E-REDES municipalities, municipality-wide RQS zone only, in the latest three reporting years. These are reliability statistics, not live outages.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
};
