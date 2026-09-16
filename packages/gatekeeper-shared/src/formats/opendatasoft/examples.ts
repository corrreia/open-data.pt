import type { ExampleFeed } from "../../index";
import { CATALOG_EXAMPLES } from "./catalog-examples";

const E_REDES_SERVING = {
  licence: "CC BY 4.0",
  attribution: "E-REDES",
} as const;

const SNS_SERVING = {
  licence: "Source terms not stated in the dataset metadata",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
} as const;

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
  serving: SNS_SERVING,
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
  serving: E_REDES_SERVING,
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
  serving: SNS_SERVING,
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
  serving: E_REDES_SERVING,
} as const;

export const OPENDATASOFT_EXAMPLES: ExampleFeed[] = [
  {
    slug: "e-redes-districts-feed",
    title: "Portuguese districts",
    description: "E-REDES district boundaries and representative points for Portugal.",
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
      serving: E_REDES_SERVING,
    },
    staleAfterSeconds: 172_800,
    publisher: "E-REDES",
    topics: ["energy"],
  },
  {
    slug: "e-redes-national-production-feed",
    title: "National electricity production",
    description: "The latest 15-minute national electricity production measurements published by E-REDES.",
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
      serving: E_REDES_SERVING,
    },
    staleAfterSeconds: 172_800,
    publisher: "E-REDES",
    topics: ["energy"],
  },
  {
    slug: "sns-newborn-screening-feed",
    title: "National newborn screening programme",
    description: "Annual newborn screening activity and detected cases published by INSA.",
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
      serving: SNS_SERVING,
    },
    staleAfterSeconds: 1_209_600,
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "sns-health-framework-agreements-feed",
    title: "Health framework agreements",
    description: "Current health-sector framework agreements, suppliers, and validity dates published by SPMS.",
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
      serving: SNS_SERVING,
    },
    staleAfterSeconds: 2_592_000,
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "sns-hospital-emergency-attendances-feed",
    title: "Hospital emergency attendances",
    description: "Monthly emergency attendances by hospital and type of emergency service.",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "atendimentos-por-tipo-de-urgencia-hospitalar-link",
      orderBy: "tempo DESC,instituicao",
      limit: "7000",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "sns-surgery-waiting-target-feed",
    title: "Patients on surgery waiting lists within the 180-day target",
    description: "Monthly registered surgery patients within and outside the 180-day maximum response time, by hospital.",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "inscritos-em-lic-dentro-do-tmrg-180-dias",
      orderBy: "tempo DESC,instituicao",
      limit: "5000",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "sns-primary-care-consultation-access-feed",
    title: "Access to primary-care medical consultations",
    description: "Monthly consultation use among registered primary-care patients, by primary-care area.",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "acesso-de-consultas-medicas-pela-populacao-inscrita",
      orderBy: "tempo DESC,entidade",
      limit: "7500",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "sns-seasonal-flu-vaccination-coverage-feed",
    title: "Seasonal influenza vaccination coverage",
    description: "Annual estimated influenza vaccination coverage for Portugal, including age groups.",
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
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "sns-dispensed-medicines-feed",
    title: "Medicines dispensed by health region",
    description: "Monthly electronic and manual prescriptions dispensed and the amount paid by the SNS.",
    config: {
      source: "opendatasoft",
      host: "transparencia.sns.gov.pt",
      dataset: "evolucao-da-dispensa-de-medicamentos",
      orderBy: "tempo DESC,regiao_de_saude",
      limit: "1000",
    },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "SNS Transparência",
    topics: ["health"],
  },
  {
    slug: "e-redes-ev-charging-connections-feed",
    title: "Electric-vehicle charging connection points",
    description: "The latest 1,000 quarterly charging connection aggregates by municipality and parish.",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "postos_carregamento_ves",
      orderBy: "trimestre DESC,coddistrito,coddistritoconcelho,coddistritoconcelhofreguesia,potencia_maxima_admissivel",
      limit: "1000",
    },
    policy: E_REDES_PERIODIC_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "E-REDES",
    topics: ["energy"],
  },
  {
    slug: "e-redes-scheduled-interruptions-feed",
    title: "Scheduled electricity interruptions",
    description: "Planned interruption windows by municipality, parish, and postal code.",
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
      serving: E_REDES_SERVING,
    },
    staleAfterSeconds: 43_200,
    publisher: "E-REDES",
    topics: ["energy"],
  },
  {
    slug: "e-redes-self-consumption-installations-feed",
    title: "Self-consumption electricity installations",
    description: "The latest 1,000 monthly self-consumption installation aggregates by place and technology.",
    config: {
      source: "opendatasoft",
      host: "e-redes.opendatasoft.com",
      dataset: "8-total-upac-mensal",
      orderBy: "data DESC,coddistrito,codconcelho,codfreguesia,tipo_de_tecnologia,nivel_de_tensao,escalao_de_potencia_instalada",
      limit: "1000",
    },
    policy: E_REDES_PERIODIC_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "E-REDES",
    topics: ["energy"],
  },
  snsDaily(
    "sns-daily-death-certificates-feed",
    "Daily death certificates",
    "Death certificates issued each day in Portugal, published by DGS.",
    "evolucao-diaria-de-certificados-de-obito",
    "data_de_certificacao DESC",
    "1000",
    "no_de_certificados_de_obito_diarios",
  ),
  snsDaily(
    "sns-icaro-heat-index-feed",
    "ÍCARO heat and mortality index",
    "INSA's daily ÍCARO index of the expected effect of heat on mortality, including the forecast days ahead.",
    "evolucao-diaria-do-indice-icaro",
    "periodo DESC",
    "1000",
  ),
  snsDaily(
    "sns-inem-emergency-calls-feed",
    "INEM emergency calls answered per day",
    "Emergency calls answered each day by INEM, the national medical emergency institute.",
    "atividade-gripe-inem",
    "periodo DESC",
    "1000",
    "n_o_registos",
  ),
  snsDaily(
    "sns-inem-dispatches-feed",
    "INEM emergency dispatches per day",
    "Daily dispatches of INEM helicopters, medical emergency cars, and ambulances.",
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
    "INEM pre-hospital occurrences by priority",
    "Daily pre-hospital occurrences handled by INEM, split by triage priority.",
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
    "Primary-care consultations and flu activity",
    "Daily primary-care consultations by health region, including consultations for flu-like illness.",
    "atendimentos-nos-csp-gripe",
    "dia DESC,regiao",
    "5000",
    "no_consultas_nos_csp,no_consultas_csp_programadas,no_consultas_csp_nao_programadas,no_consultas_gripe_nos_csp",
  ),
  snsDaily(
    "sns-continuing-care-waiting-feed",
    "Patients waiting for continuing-care places",
    "Daily count of patients waiting for a place in the national continuing-care network, by region and care type.",
    "rncci-episodios",
    "data DESC,regiao,tipologia",
    "5000",
    "episodios",
  ),
  snsMonthly(
    "sns-hospital-occupancy-feed",
    "Hospital inpatient occupancy",
    "Monthly inpatient days, staffed beds, and occupancy rate by hospital.",
    "ocupacao-do-internamento",
    "8000",
  ),
  snsMonthly(
    "sns-emergency-triage-feed",
    "Hospital emergency attendances by triage colour",
    "Monthly emergency attendances by hospital and Manchester triage priority, for about the last three years.",
    "atendimentos-em-urgencia-triagem-manchester",
    // Seven counts per row; the full table normalizes to more than 16 MiB.
    "3000",
  ),
  snsMonthly(
    "sns-births-and-caesareans-feed",
    "Hospital births and caesarean sections",
    "Monthly births and caesarean sections by hospital.",
    "partos-e-cesarianas",
    "7000",
  ),
  eRedes(
    "e-redes-national-consumption-feed",
    "National electricity consumption",
    "The latest 15-minute national electricity consumption by voltage level, published by E-REDES.",
    { dataset: "consumo-total-nacional", orderBy: "datahora DESC", limit: "1000", series: "total,bt,mt,at,mat" },
    E_REDES_QUARTER_HOUR_SERIES,
    172_800,
  ),
  eRedes(
    "e-redes-distribution-injection-feed",
    "Energy injected into the distribution network",
    "The latest 15-minute energy injected into the distribution network by cogeneration, wind, solar, hydro, and other sources.",
    {
      dataset: "energia-injetada-na-rede-de-distribuicao",
      orderBy: "datahora DESC",
      limit: "1000",
      series: "rede_dist,cogeracao,eolica,fotovoltaica,hidrica,outras_tecnologias",
    },
    E_REDES_QUARTER_HOUR_SERIES,
    172_800,
  ),
  eRedes(
    "e-redes-consumption-forecast-feed",
    "Electricity consumption forecast",
    "E-REDES 15-minute consumption forecast by voltage level, from the past day to seven days ahead.",
    {
      dataset: "previsao-de-consumo",
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
    "Energy communities and collective self-consumption",
    "Monthly count of energy communities and collective self-consumption schemes by parish.",
    { dataset: "comunidades-de-energia", orderBy: "data DESC,codigo_freguesia,tipo_acc_cer", limit: "5000" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  eRedes(
    "e-redes-grid-reception-capacity-feed",
    "Grid capacity for new generation",
    "Connected, committed, and still available capacity for new generation at each E-REDES substation.",
    { dataset: "capacidade-rececao-rnd", orderBy: "chave", limit: "1000" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  eRedes(
    "e-redes-substation-load-feed",
    "Substation load",
    "Annual winter and summer load, installed power, and guaranteed power for each E-REDES substation.",
    { dataset: "carga-na-subestacao", orderBy: "ano DESC,codigo_da_instalacao,inverno_verao", limit: "1000" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  eRedes(
    "e-redes-ev-grid-connection-requests-feed",
    "Grid connections for electric mobility",
    "Monthly grid-connection requests completed for electric-vehicle charging, by municipality.",
    { dataset: "9-plr-mobilidade-eletrica", orderBy: "data DESC,cod_concelho", limit: "1500" },
    E_REDES_PERIODIC_SERIES,
    1_209_600,
  ),
  ...CATALOG_EXAMPLES,
];

/** An SNS dataset published day by day, collected twice a day. */
function snsDaily(
  slug: string,
  title: string,
  description: string,
  dataset: string,
  orderBy: string,
  limit: string,
  series?: string,
): ExampleFeed {
  // Named numeric fields make the dataset a time series; without them it is a table.
  const config: ExampleFeed["config"] = { source: "opendatasoft", host: "transparencia.sns.gov.pt", dataset, orderBy, limit };
  if (series) config.series = series;
  return {
    slug,
    title,
    description,
    config,
    policy: SNS_DAILY_SERIES,
    staleAfterSeconds: 172_800,
    publisher: "SNS Transparência",
    topics: ["health"],
  };
}

/** An SNS dataset with one row per hospital and month. */
function snsMonthly(
  slug: string,
  title: string,
  description: string,
  dataset: string,
  limit: string,
): ExampleFeed {
  return {
    slug,
    title,
    description,
    config: { source: "opendatasoft", host: "transparencia.sns.gov.pt", dataset, orderBy: "tempo DESC,instituicao", limit },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "SNS Transparência",
    topics: ["health"],
  };
}

/** The part of an E-REDES feed configuration that differs between datasets. */
interface ERedesQuery {
  dataset: string;
  orderBy: string;
  limit: string;
  where?: string;
  /** Numeric fields to publish as series; the dataset is then not published as a table. */
  series?: string;
}

function eRedes(
  slug: string,
  title: string,
  description: string,
  query: ERedesQuery,
  policy: ExampleFeed["policy"],
  staleAfterSeconds: number,
): ExampleFeed {
  return {
    slug,
    title,
    description,
    config: { source: "opendatasoft", host: "e-redes.opendatasoft.com", ...query },
    policy,
    staleAfterSeconds,
    publisher: "E-REDES",
    topics: ["energy"],
  };
}
