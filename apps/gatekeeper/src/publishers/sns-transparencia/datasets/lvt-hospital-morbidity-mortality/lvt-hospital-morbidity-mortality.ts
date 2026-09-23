import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-lvt-hospital-morbidity-mortality-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "morbilidade-e-mortalidade-hospitalar",
    timeField: "ano",
    quarterField: "trimestre",
    period: "year",
    windowPeriods: "1",
    where: "regiao = 'Região de Saúde LVT'",
    select: "ano,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
    groupBy: "ano,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
    orderBy: "ano DESC,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
    idFields: "ano,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
    units: "dias_internamento=days",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 1 years of SNS Transparência's `morbilidade-e-mortalidade-hospitalar` dataset, by `ano`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
