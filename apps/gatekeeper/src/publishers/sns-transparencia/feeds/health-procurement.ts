import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_PERIODS, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-health-procurement-feed",
  title: "Public health-sector contracts",
  description:
    "Health-sector procurement published in SNS Transparência's Portal BASE extract, latest sixty source publication days. Rows have provisional content-derived identities because this extract omits contract IDs; it is not the complete national BASE register.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "portal-base",
    timeField: "data_de_publicacao",
    period: "day",
    windowPeriods: "60",
    orderBy: "data_de_publicacao DESC,data_de_celebracao_do_contrato,nifs_dos_adjudicantes,nifs_das_adjudicatarias,objeto_do_contrato,preco_contratual",
  },
  policy: SNS_DAILY_PERIODS,
  staleAfterSeconds: 172_800,
  /** Once a day: the latest 60 days of SNS Transparência's `portal-base` dataset, by `data_de_publicacao`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `portal-base` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
