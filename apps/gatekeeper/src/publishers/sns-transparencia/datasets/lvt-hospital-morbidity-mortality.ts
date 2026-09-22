import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Reported hospital morbidity and mortality figures in Lisbon and Tagus Valley",
  description:
    "Distinct source-reported inpatient days, hospitalisation rates and mortality rates by institution and diagnostic chapter in Região de Saúde LVT, latest reporting year. The portal includes conflicting unlabelled revisions for the same year/quarter/institution/chapter: these are preserved as separate figure records, not arbitrarily selected as a single time series. Report dates are discharge quarters; revision times and which figure is newest are unknown.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-lvt-hospital-morbidity-mortality-feed", {
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
    }),
  ],
};
