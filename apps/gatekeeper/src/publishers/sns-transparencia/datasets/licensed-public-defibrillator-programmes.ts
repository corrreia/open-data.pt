import type { DatasetDefinition } from "../../../catalog/define";
import { MONTH } from "../../../formats/opendatasoft/feeds";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Licensed public-space defibrillator programmes",
  description:
    "The complete published register of public-space defibrillator programmes, with establishment, address and reporting month. The portal's numeric record field is an identifier, not a count or a live AED availability measurement.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health(
      "sns-licensed-public-defibrillator-programmes-feed",
      {
        dataset: "evolucao-programas-dae-licenciados-em-espacos-publicos",
        timeField: "tempo",
        orderBy: "tempo DESC,n_o_registos",
        idFields: "n_o_registos",
      },
      MONTH,
    ),
  ],
};
