import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATISTICS } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Direct debit system participants",
  description: "Monthly and annual counts of active creditors and direct debit authorisations by SEPA scheme.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    {
      slug: "bpstat-payment-system-participants",
      config: {
        source: "bpstat",
        domain: "8",
        dataset: "00ac0311f09ecac48b82a9d92f8aa462",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
