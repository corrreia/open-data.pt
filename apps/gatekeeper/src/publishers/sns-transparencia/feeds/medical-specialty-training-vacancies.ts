import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-medical-specialty-training-vacancies-feed",
  title: "Medical specialty training vacancies",
  description:
    "Available, filled and unfilled medical-internship specialty training places, latest three reporting years, preserved as records using the publisher's unique registo IDs. Some historical records share year, region, institution and specialty but report different counts without a cohort or revision label; these remain separate records rather than arbitrarily selected or summed series points.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "vagas-formacao-especializada-internato",
    timeField: "periodo",
    period: "year",
    windowPeriods: "3",
    orderBy: "periodo DESC,regiao,instituicao,especialidade,registo",
    idFields: "registo",
    units: "vagas_disponiveis=places,vagas_ocupadas=places,vagas_nao_ocupadas=places",
  },
  policy: SNS_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest 3 years of SNS Transparência's `vagas-formacao-especializada-internato` dataset, by `periodo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `vagas-formacao-especializada-internato` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
