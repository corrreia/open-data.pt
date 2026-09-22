import type { ExampleFeed } from "../../index";
import { CATALOG_EXAMPLES } from "./catalog-examples";

const MEBIBYTE = 1024 * 1024;

const SNS_MONTHLY_SERIES = {
  name: "SNS monthly series snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 180,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

const E_REDES_PERIODIC_SERIES = {
  name: "E-REDES periodic series subset",
  version: 1,
  collection: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 180,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

const SNS_DAILY_SERIES = {
  name: "SNS daily series snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 43_200,
    timeoutSeconds: 60,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

const E_REDES_QUARTER_HOUR_SERIES = {
  name: "E-REDES quarter-hour series",
  version: 1,
  collection: {
    cadenceSeconds: 21_600,
    timeoutSeconds: 180,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

export const OPENDATASOFT_EXAMPLES: ExampleFeed[] = [
  {
    slug: "e-redes-districts-feed",
    dataset: "e-redes-districts",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "districts-portugal",
      orderBy: "dis_code",
      limit: "100",
    },
    policy: {
      name: "Opendatasoft reference snapshot",
      version: 1,
      collection: {
        cadenceSeconds: 86_400,
        timeoutSeconds: 180,
        maxBytes: 8 * 1024 * 1024,
        maxOutputBytes: 32 * 1024 * 1024,
        maxRecordBytes: 2 * 1024 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "e-redes-national-production-feed",
    dataset: "e-redes-national-production",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "energia-produzida-total-nacional",
      orderBy: "datahora DESC",
      limit: "1000",
      series: "total,dgm,pre",
    },
    policy: {
      name: "Opendatasoft daily series subset",
      version: 1,
      collection: {
        cadenceSeconds: 21_600,
        timeoutSeconds: 180,
        maxBytes: 8 * 1024 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "sns-newborn-screening-feed",
    dataset: "sns-transparencia-newborn-screening",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "programa-nacional-de-diagnostico-precoce",
      orderBy: "tempo",
      limit: "100",
    },
    policy: {
      name: "Opendatasoft slow series",
      version: 1,
      collection: {
        cadenceSeconds: 604_800,
        timeoutSeconds: 30,
        maxBytes: 2 * 1024 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "sns-health-framework-agreements-feed",
    dataset: "sns-transparencia-health-framework-agreements",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "acordos-quadro-na-area-da-saude",
      orderBy: "referencia_do_acordo_quadro",
      limit: "500",
    },
    policy: {
      name: "Opendatasoft changing reference data",
      version: 1,
      collection: {
        cadenceSeconds: 86_400,
        timeoutSeconds: 30,
        maxBytes: 2 * 1024 * 1024,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 2_592_000,
  },
  {
    slug: "sns-hospital-emergency-attendances-feed",
    dataset: "sns-transparencia-hospital-emergency-attendances",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "atendimentos-por-tipo-de-urgencia-hospitalar-link",
      orderBy: "tempo DESC,instituicao",
      limit: "7000",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "sns-surgery-waiting-target-feed",
    dataset: "sns-transparencia-surgery-waiting-target",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "inscritos-em-lic-dentro-do-tmrg-180-dias",
      orderBy: "tempo DESC,instituicao",
      limit: "5000",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "sns-primary-care-consultation-access-feed",
    dataset: "sns-transparencia-primary-care-consultation-access",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "acesso-de-consultas-medicas-pela-populacao-inscrita",
      orderBy: "tempo DESC,entidade",
      limit: "7500",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "sns-seasonal-flu-vaccination-coverage-feed",
    dataset: "sns-transparencia-seasonal-flu-vaccination-coverage",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "taxa-de-cobertura-da-vacina-antigripal-sazonal-na-populacao-em-portugal-continen",
      orderBy: "epoca_sazonal DESC",
      limit: "100",
    },
    policy: {
      ...SNS_MONTHLY_SERIES,
      name: "SNS annual series snapshot",
      collection: {
        ...SNS_MONTHLY_SERIES.collection,
        cadenceSeconds: 2_592_000,
      },
    },
    staleAfterSeconds: 5_184_000,
  },
  {
    slug: "sns-dispensed-medicines-feed",
    dataset: "sns-transparencia-dispensed-medicines",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "evolucao-da-dispensa-de-medicamentos",
      orderBy: "tempo DESC,regiao_de_saude",
      limit: "1000",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "e-redes-ev-charging-connections-feed",
    dataset: "e-redes-ev-charging-connections",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "postos_carregamento_ves",
      orderBy: "trimestre DESC,coddistrito,coddistritoconcelho,coddistritoconcelhofreguesia,potencia_maxima_admissivel",
      limit: "1000",
    },
    policy: E_REDES_PERIODIC_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "e-redes-scheduled-interruptions-feed",
    dataset: "e-redes-scheduled-interruptions",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "network-scheduling-work",
      orderBy: "updatedatetime DESC,startdatetime,zipcode",
      limit: "500",
    },
    policy: {
      name: "E-REDES scheduled interruption changes",
      version: 1,
      collection: {
        cadenceSeconds: 21_600,
        timeoutSeconds: 30,
        maxBytes: 2 * MEBIBYTE,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 43_200,
  },
  {
    slug: "e-redes-self-consumption-installations-feed",
    dataset: "e-redes-self-consumption-installations",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "8-total-upac-mensal",
      orderBy: "data DESC,coddistrito,codconcelho,codfreguesia,tipo_de_tecnologia,nivel_de_tensao,escalao_de_potencia_instalada",
      limit: "1000",
    },
    policy: E_REDES_PERIODIC_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  snsDaily(
    "sns-daily-death-certificates-feed",
    "sns-transparencia-daily-death-certificates",
    "evolucao-diaria-de-certificados-de-obito",
    "data_de_certificacao DESC",
    "1000",
    "no_de_certificados_de_obito_diarios",
  ),
  snsDaily("sns-icaro-heat-index-feed", "sns-transparencia-icaro-heat-index", "evolucao-diaria-do-indice-icaro", "periodo DESC", "1000"),
  snsDaily("sns-inem-emergency-calls-feed", "sns-transparencia-inem-emergency-calls", "atividade-gripe-inem", "periodo DESC", "1000", "n_o_registos"),
  snsDaily(
    "sns-inem-dispatches-feed",
    "sns-transparencia-inem-dispatches",
    "acionamentos-de-meios-de-emergencia-medica",
    "periodo DESC",
    "1000",
    [
      "no_de_acionamentos_das_ambulancias_de_emergencia_medica_aem",
      "no_de_acionamentos_das_ambulancias_de_suporte_imediato_de_vida_siv",
      "no_de_acionamentos_das_viaturas_medica_de_emergencia_e_reanimacao_vmer",
      "no_de_acionamentos_dos_motociclos_de_emergencia_medica_mem",
      "no_de_acionamentos_do_servico_de_helicopteros_de_emergencia_medica_shem",
      "no_de_acionamentos_de_ambulancias_de_transporte_inter_hospitalar_pediatrico_tip",
      "no_de_acionamentos_das_unidade_movel_de_intervencao_psicologica_de_emergencia_umipe",
      "no_de_acionamentos_das_ambulancias_de_socorro_sedeadas_em_postos_de_emergencia_medica_pem",
      "no_de_acionamentos_das_ambulancias_de_socorro_sedeadas_em_postos_reserva_res",
      "no_de_acionamentos_das_ambulancias_sedeadas_em_postos_nao_inem_ninem",
    ].join(","),
  ),
  snsDaily(
    "sns-inem-occurrences-by-priority-feed",
    "sns-transparencia-inem-occurrences-by-priority",
    "numero-de-ocorrencia-com-prioridade",
    "periodo DESC",
    "1000",
    [
      "no_ocorrencias_emergentes_classificadas_com_prioridade_1_situacoes_associadas_a_risco_de_vida_iminen",
      "no_ocorrencias_muito_urgentes_classificadas_com_prioridade_2_situacoes_com_risco_clinico_elevado_pre",
      "no_ocorrencias_urgentes_classificadas_com_prioridade_3_situacoes_com_risco_de_agravamento_clinico_im",
      "no_ocorrencias_pouco_urgentes_classificadas_com_prioridade_4_situacoes_associadas_a_risco_clinico_ba",
      "no_ocorrencias_nao_urgentes_classificadas_com_prioridade_5_situacoes_que_nao_implicam_o_envio_de_mei",
      "no_ocorrencias_nao_urgentes_classificadas_com_outras_prioridades_sem_acionamento_de_meios",
    ].join(","),
  ),
  snsDaily(
    "sns-primary-care-flu-consultations-feed",
    "sns-transparencia-primary-care-flu-consultations",
    "atendimentos-nos-csp-gripe",
    "dia DESC,regiao",
    "5000",
    "no_consultas_nos_csp,no_consultas_csp_programadas,no_consultas_csp_nao_programadas,no_consultas_gripe_nos_csp",
  ),
  snsDaily("sns-continuing-care-waiting-feed", "sns-transparencia-continuing-care-waiting", "rncci-episodios", "data DESC,regiao,tipologia", "5000", "episodios"),
  snsMonthly("sns-hospital-occupancy-feed", "sns-transparencia-hospital-occupancy", "ocupacao-do-internamento", "8000"),
  snsMonthly(
    "sns-emergency-triage-feed",
    "sns-transparencia-emergency-triage",
    "atendimentos-em-urgencia-triagem-manchester",
    // Seven counts per row; the full table normalizes to more than 16 MiB.
    "3000",
  ),
  snsMonthly("sns-births-and-caesareans-feed", "sns-transparencia-births-and-caesareans", "partos-e-cesarianas", "7000"),
  eRedes(
    "e-redes-national-consumption-feed",
    "e-redes-national-consumption",
    { portalDataset: "consumo-total-nacional", orderBy: "datahora DESC", limit: "1000", series: "total,bt,mt,at,mat" },
    E_REDES_QUARTER_HOUR_SERIES,
    172_800,
  ),
  eRedes(
    "e-redes-distribution-injection-feed",
    "e-redes-distribution-injection",
    {
      portalDataset: "energia-injetada-na-rede-de-distribuicao",
      orderBy: "datahora DESC",
      limit: "1000",
      series: "rede_dist,cogeracao,eolica,fotovoltaica,hidrica,outras_tecnologias",
    },
    E_REDES_QUARTER_HOUR_SERIES,
    172_800,
  ),
  eRedes(
    "e-redes-consumption-forecast-feed",
    "e-redes-consumption-forecast",
    {
      portalDataset: "previsao-de-consumo",
      where: "datahora >= now(days=-1) AND datahora < now(days=8)",
      orderBy: "datahora",
      limit: "1000",
      series: "total,bt,mt,at,mat",
    },
    E_REDES_QUARTER_HOUR_SERIES,
    172_800,
  ),
  eRedes(
    "e-redes-energy-communities-feed",
    "e-redes-energy-communities",
    { portalDataset: "comunidades-de-energia", orderBy: "data DESC,codigo_freguesia,tipo_acc_cer", limit: "5000" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  eRedes(
    "e-redes-grid-reception-capacity-feed",
    "e-redes-grid-reception-capacity",
    { portalDataset: "capacidade-rececao-rnd", orderBy: "chave", limit: "1000" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  eRedes(
    "e-redes-substation-load-feed",
    "e-redes-substation-load",
    { portalDataset: "carga-na-subestacao", orderBy: "ano DESC,codigo_da_instalacao,inverno_verao", limit: "1000" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  eRedes(
    "e-redes-ev-grid-connection-requests-feed",
    "e-redes-ev-grid-connection-requests",
    { portalDataset: "9-plr-mobilidade-eletrica", orderBy: "data DESC,cod_concelho", limit: "1500" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  ...CATALOG_EXAMPLES,
];

/** An SNS dataset published day by day, collected twice a day. */
function snsDaily(slug: string, dataset: string, portalDataset: string, orderBy: string, limit: string, series?: string): ExampleFeed {
  // Named numeric fields make the dataset a time series; without them it is a table.
  const config: ExampleFeed["config"] = { source: "opendatasoft", host: "transparencia.sns.gov.pt", dataset: portalDataset, orderBy, limit };
  if (series) config.series = series;
  return {
    slug,
    dataset,
    config,
    policy: SNS_DAILY_SERIES,
    staleAfterSeconds: 172_800,
  };
}

/** An SNS dataset with one row per hospital and month. */
function snsMonthly(slug: string, dataset: string, portalDataset: string, limit: string): ExampleFeed {
  return {
    slug,
    dataset,
    config: { source: "opendatasoft", host: "transparencia.sns.gov.pt", dataset: portalDataset, orderBy: "tempo DESC,instituicao", limit },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  };
}

/** The part of an E-REDES feed configuration that differs between datasets. */
interface ERedesQuery {
  /** The dataset id on the E-REDES portal. */
  portalDataset: string;
  orderBy: string;
  limit: string;
  where?: string;
  /** Numeric fields to publish as series; the dataset is then not published as a table. */
  series?: string;
}

function eRedes(slug: string, dataset: string, query: ERedesQuery, policy: ExampleFeed["policy"], staleAfterSeconds: number): ExampleFeed {
  const { portalDataset, ...rest } = query;
  return {
    slug,
    dataset,
    config: { source: "opendatasoft", host: "e-redes.opendatasoft.com", dataset: portalDataset, ...rest },
    policy,
    staleAfterSeconds,
  };
}
