import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Public health-sector contracts",
  description:
    "Health-sector procurement published in SNS Transparência's Portal BASE extract, latest sixty source publication days. Rows have provisional content-derived identities because this extract omits contract IDs; it is not the complete national BASE register.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health(
      "sns-health-procurement-feed",
      {
        dataset: "portal-base",
        timeField: "data_de_publicacao",
        period: "day",
        windowPeriods: "60",
        orderBy: "data_de_publicacao DESC,data_de_celebracao_do_contrato,nifs_dos_adjudicantes,nifs_das_adjudicatarias,objeto_do_contrato,preco_contratual",
      },
      86_400,
    ),
  ],
};
