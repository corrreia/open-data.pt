import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Cancer screening in primary care",
  description:
    "Reported breast, cervical and colorectal screening counts and proportions by primary-care area, latest twenty-four reporting months. Eligibility and look-back periods follow the source definitions.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-cancer-screening-feed", {
      dataset: "rastreios-oncologicos",
      timeField: "tempo",
      period: "month",
      windowPeriods: "24",
      orderBy: "tempo DESC,regiao,area_csp",
      dimensions: "regiao,area_csp",
      series:
        "contagem_de_mulheres_com_registo_de_mamografia_nos_ultimos_dois_anos,proporcao_mulheres_50_70_a_c_mamogr_2_anos,contagem_de_mulheres_com_colpocitologia_atualizada,proporcao_mulheres_25_60_a_c_colpoc_atuali,contagem_de_utentes_inscritos_com_rastreio_do_cancro_do_colon_e_reto_efetuado,proporcao_utentes_50_75_a_c_rastreio_cancro_cr",
      units:
        "contagem_de_mulheres_com_registo_de_mamografia_nos_ultimos_dois_anos=women,contagem_de_mulheres_com_colpocitologia_atualizada=women,contagem_de_utentes_inscritos_com_rastreio_do_cancro_do_colon_e_reto_efetuado=patients",
    }),
  ],
};
