import type { ExampleFeed, SourceConfig } from "../../index";

const MEBIBYTE = 1024 * 1024;
const WEEK = 604_800;
const MONTH = 2_592_000;

/** Source-side scopes, checked against Explore v2.1 metadata and records in September 2026. */
export const CATALOG_EXAMPLES: ExampleFeed[] = [
  energy("e-redes-service-continuity-feed", "Electricity service continuity by municipality",
    "Annual SAIFI, SAIDI, MAIFI, TIEPI and energy-not-distributed indicators for all E-REDES municipalities, municipality-wide RQS zone only, in the latest three reporting years. These are reliability statistics, not live outages.", {
      dataset: "12-continuidade-de-servico-indicadores-gerais-de-continuidade-de-servico",
      timeField: "ano", period: "year", windowPeriods: "3", where: "zona_rqs = 'Concelho'",
      orderBy: "ano DESC,codigo_concelho,zona_rqs", dimensions: "codigo_concelho,zona_rqs",
      series: "saifi_at_num,saidi_at_min,maifi_at_num,tiepi_mt_min,end_mt_mwh,saifi_mt_num,saidi_mt_min,maifi_mt_num,saifi_bt_num,saidi_bt_min",
      units: "saifi_at_num=interruptions,saidi_at_min=min,maifi_at_num=interruptions,tiepi_mt_min=min,end_mt_mwh=MWh,saifi_mt_num=interruptions,saidi_mt_min=min,maifi_mt_num=interruptions,saifi_bt_num=interruptions,saidi_bt_min=min",
    }, MONTH),
  energy("e-redes-municipal-monthly-consumption-feed", "Monthly electricity consumption by municipality and voltage",
    "E-REDES billed active energy, summed by the source from parish rows into municipality and voltage-level totals. All published municipalities, latest twelve reporting months; Includes source-suppressed OUTROS district groups rather than attributing them to a municipality; not island consumption outside E-REDES coverage.", {
      dataset: "3-consumos-faturados-por-municipio-ultimos-10-anos", timeField: "data", period: "month", windowPeriods: "12",
      select: "data,coddistritoconcelho,concelho,nivel_de_tensao,sum(energia_ativa_kwh) as energia_ativa_kwh",
      groupBy: "data,coddistritoconcelho,concelho,nivel_de_tensao",
      orderBy: "data DESC,coddistritoconcelho,concelho,nivel_de_tensao", dimensions: "coddistritoconcelho,concelho,nivel_de_tensao", series: "energia_ativa_kwh", units: "energia_ativa_kwh=kWh",
    }),
  energy("e-redes-active-smart-meter-contracts-feed", "Active electricity contracts by meter type and district",
    "Active delivery-point contracts with and without smart meters, summed by E-REDES from parish rows into district totals. All districts in its service area, latest twelve reporting months; inactive contracts excluded.", {
      dataset: "21-contadores-de-energia", timeField: "data", period: "month", windowPeriods: "12", where: "contrato_ativo = 'Sim'",
      select: "data,coddistrito,distrito,inclui_emi,sum(cpes) as cpes", groupBy: "data,coddistrito,distrito,inclui_emi",
      orderBy: "data DESC,coddistrito,distrito,inclui_emi", dimensions: "coddistrito,distrito,inclui_emi", series: "cpes", units: "cpes=delivery points",
    }),
  energy("e-redes-municipal-contracted-capacity-feed", "Contracted electricity capacity by municipality",
    "Contracted capacity summed by the source from parish rows for every E-REDES municipality, latest twelve reporting months. Contract counts are not repeated here.", {
      dataset: "potencia-contratada-contratos-ativos-municipio", timeField: "data", period: "month", windowPeriods: "12",
      select: "data,con_code,con_name,sum(potencia_contratada) as potencia_contratada", groupBy: "data,con_code,con_name",
      orderBy: "data DESC,con_code,con_name", dimensions: "con_code,con_name", series: "potencia_contratada", units: "potencia_contratada=kVA",
    }),
  energy("e-redes-contracts-by-power-band-feed", "Electricity contracts by district and power band",
    "Contract counts by district and contracted-power band, aggregated by the source from parish detail. All E-REDES districts, latest twelve reporting months; no arbitrary parish sample.", {
      dataset: "clientes-por-escalao-de-potencia", timeField: "data", period: "month", windowPeriods: "12",
      select: "data,dis_code,segmento_de_potencia_contratada,sum(numero_de_contratos) as numero_de_contratos", groupBy: "data,dis_code,segmento_de_potencia_contratada",
      orderBy: "data DESC,dis_code,segmento_de_potencia_contratada", dimensions: "dis_code,segmento_de_potencia_contratada", series: "numero_de_contratos", units: "numero_de_contratos=contracts",
    }),
  energy("e-redes-municipal-transformer-capacity-feed", "Distribution transformer stations by municipality",
    "A source-computed count of distribution transformer stations and their total installed capacity by municipality across the E-REDES service area. This is a municipal inventory summary, not individual station locations.", {
      dataset: "postos-transformacao-distribuicao",
      select: "coddistritoconcelho,con_name,count(cod_instalacao) as station_count,sum(potencia_transformacao_kva) as potencia_transformacao_kva",
      groupBy: "coddistritoconcelho,con_name", orderBy: "coddistritoconcelho,con_name", idFields: "coddistritoconcelho,con_name", limit: "1000",
    }, MONTH),
  energy("e-redes-self-consumption-exported-energy-feed", "Energy exported by self-consumption installations",
    "Monthly energy injected by self-consumption installations, summed by E-REDES into municipality and voltage-level totals for the latest six reporting months. Does not repeat the existing installation-count products.", {
      dataset: "energia_injectada_upac", timeField: "data", period: "month", windowPeriods: "6",
      select: "data,codigo_concelho,con_name,nivel_tensao,sum(energia) as energia", groupBy: "data,codigo_concelho,con_name,nivel_tensao",
      orderBy: "data DESC,codigo_concelho,con_name,nivel_tensao", dimensions: "codigo_concelho,con_name,nivel_tensao", series: "energia", units: "energia=kWh",
    }),
  energy("e-redes-hourly-consumption-lisbon-porto-postcodes-feed", "Historical hourly electricity consumption in postal areas 1000 and 4000",
    "Source-reported hourly consumption for four-digit postal areas 1000 (Lisbon) and 4000 (Porto), latest 168 source reporting hours. A fixed two-area comparison, not national consumption or a claim of real-time freshness.", {
      dataset: "consumos_horario_codigo_postal", timeField: "datahora", period: "hour", windowPeriods: "168", where: "codigo_postal IN ('1000','4000')",
      select: "datahora,codigo_postal,consumo", orderBy: "datahora DESC,codigo_postal", dimensions: "codigo_postal", series: "consumo", units: "consumo=kWh", limit: "1000",
    }, MONTH),
  energy("e-redes-monthly-postal-consumption-feed", "Monthly electricity consumption by four-digit postal area",
    "Billed active energy for every four-digit postal area published by E-REDES, latest six reporting months. These are postal areas, not seven-digit delivery addresses.", {
      dataset: "02-consumos-faturados-por-codigo-postal-ultimos-5-anos", timeField: "date", period: "month", windowPeriods: "6",
      select: "date,codigopostal,energiaativa", orderBy: "date DESC,codigopostal", dimensions: "codigopostal", series: "energiaativa", units: "energiaativa=kWh",
    }),
  energy("e-redes-municipal-tariff-consumption-feed", "Municipal electricity consumption by tariff period",
    "Billed active energy in the source's six tariff-period categories, summed across parishes for every E-REDES municipality, latest six reporting months. The overall energy total is not repeated.", {
      dataset: "consumos-faturados-por-periodo-tarifario", timeField: "data", period: "month", windowPeriods: "6",
      select: "data,con_code,sum(energia_ativa_simples_kwh) as energia_ativa_simples_kwh,sum(energia_ativa_vazio_kwh) as energia_ativa_vazio_kwh,sum(energia_ativa_fora_de_vazio_kwh) as energia_ativa_fora_de_vazio_kwh,sum(energia_ativa_super_vazio_kwh) as energia_ativa_super_vazio_kwh,sum(energia_ativa_ponta_kwh) as energia_ativa_ponta_kwh,sum(energia_ativa_cheias_kwh) as energia_ativa_cheias_kwh",
      groupBy: "data,con_code", orderBy: "data DESC,con_code", dimensions: "con_code",
      series: "energia_ativa_simples_kwh,energia_ativa_vazio_kwh,energia_ativa_fora_de_vazio_kwh,energia_ativa_super_vazio_kwh,energia_ativa_ponta_kwh,energia_ativa_cheias_kwh",
    }),
  energy("e-redes-municipal-street-lighting-feed", "Public street lighting by municipality and lamp type",
    "E-REDES public-lighting counts and installed power, summed by the source from parish aggregates into municipality and lamp-type totals. The reporting clock is the published year and month, not collection time; this is not a map of individual lamps.", {
      dataset: "cadastro_iluminacao_publica", timeField: "ano", monthField: "mes",
      select: "ano,mes,coddistritoconcelho,tipo_de_lampada,sum(luminarias) as luminarias,sum(lampadas) as lampadas,sum(potencia_instalada_total) as potencia_instalada_total",
      groupBy: "ano,mes,coddistritoconcelho,tipo_de_lampada", orderBy: "ano DESC,mes DESC,coddistritoconcelho,tipo_de_lampada",
      dimensions: "coddistritoconcelho,tipo_de_lampada", series: "luminarias,lampadas,potencia_instalada_total", units: "luminarias=luminaires,lampadas=lamps,potencia_instalada_total=W",
    }, MONTH),
  health("sns-health-procurement-feed", "Public health-sector contracts",
    "Health-sector procurement published in SNS Transparência's Portal BASE extract, latest sixty source publication days. Rows have provisional content-derived identities because this extract omits contract IDs; it is not the complete national BASE register.", {
      dataset: "portal-base", timeField: "data_de_publicacao", period: "day", windowPeriods: "60",
      orderBy: "data_de_publicacao DESC,data_de_celebracao_do_contrato,nifs_dos_adjudicantes,nifs_das_adjudicatarias,objeto_do_contrato,preco_contratual",
    }, 86_400),
  health("sns-psychology-consultations-feed", "Psychology consultations by hospital",
    "First, subsequent and total psychology consultations by hospital and month, latest twenty-four reporting months.", {
      dataset: "evolucao-mensal-das-consultas-de-psicologia", timeField: "tempo", period: "month", windowPeriods: "24", orderBy: "tempo DESC,regiao,instituicao", dimensions: "regiao,instituicao",
      series: "psicologia_primeiras_consultas,psicologia_consultas_subsequentes,psicologia_total_de_consultas", units: "psicologia_primeiras_consultas=consultations,psicologia_consultas_subsequentes=consultations,psicologia_total_de_consultas=consultations",
    }),
  health("sns-medicine-package-prices-feed", "Average medicine-package prices",
    "Average outpatient and generic medicine-package prices by health region, latest thirty-six reporting months. Not pharmacy-level retail prices; underlying expenditure and package counts are not republished here.", {
      dataset: "preco-medio-por-embalagem", timeField: "tempo", period: "month", windowPeriods: "36", orderBy: "tempo DESC,regiao", dimensions: "regiao",
      series: "preco_medio_por_embalagem_ambulatorio,preco_medio_por_embalagem_genericos",
    }),
  health("sns-sickness-self-declarations-feed", "Sickness self-declarations by channel, sex and age",
    "Daily counts of sickness self-declarations, partitioned by source channel, sex and age group, latest sixty source reporting days. No individual health records.", {
      dataset: "autodeclaracoes-de-doenca-dos-utentes", timeField: "des_dia", period: "day", windowPeriods: "60", orderBy: "des_dia DESC,tipo_origem,des_sexo,grupo_etario",
      dimensions: "tipo_origem,des_sexo,grupo_etario", series: "qtd_add", units: "qtd_add=declarations",
    }, 86_400),
  health("sns-emergency-calls-transferred-sns24-feed", "Emergency calls transferred to SNS 24",
    "Monthly emergency calls transferred to the SNS 24 health line, latest sixty reporting months. Distinct from INEM's total calls answered.", {
      dataset: "sns24", timeField: "data", period: "month", windowPeriods: "60", orderBy: "data DESC", dimensions: "", series: "n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24", units: "n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24=calls",
    }),
  health("sns-blood-collection-feed", "Historical blood collection by institution and blood group",
    "Monthly blood units collected, including donors under 25, by region, institution and blood group, latest twelve reporting months. Null source measurements remain missing rather than becoming zero.", {
      dataset: "colheita-de-sangue-total", timeField: "periodo", period: "month", windowPeriods: "12", orderBy: "periodo DESC,regiao,entidade,grupo_sanguineo", dimensions: "regiao,entidade,grupo_sanguineo",
      series: "no_total_de_unidades_de_sangue_colhidas,no_total_de_unidades_de_sangue_colhidas_no_grupo_etario_25_anos", units: "no_total_de_unidades_de_sangue_colhidas=blood units,no_total_de_unidades_de_sangue_colhidas_no_grupo_etario_25_anos=blood units",
    }, MONTH),
  health("sns-generic-medicine-dispensing-feed", "Generic medicine dispensing and market share",
    "Generic medicine expenditure, units dispensed and market shares by health region, latest thirty-six reporting months. Market shares are source fractions (0 to 1), despite percent annotations in the portal; no scaling is inferred.", {
      dataset: "genericos", timeField: "tempo", period: "month", windowPeriods: "36", orderBy: "tempo DESC,regiao", dimensions: "regiao",
      series: "valor_pvp_genericos,unidades_dispensadas_genericos,qm_genericos_valor_pvp,qm_genericos_unidades_dispensadas", units: "unidades_dispensadas_genericos=dispensed units,qm_genericos_valor_pvp=ratio,qm_genericos_unidades_dispensadas=ratio",
    }),
  health("sns-supplier-debt-and-arrears-feed", "Health-service supplier debt and payment arrears",
    "Total external-supplier debt, overdue debt and payment arrears by region and institution, latest twenty-four reporting months, in euros.", {
      dataset: "divida-total-vencida-e-pagamentos", timeField: "periodo", period: "month", windowPeriods: "24", orderBy: "periodo DESC,regiao,entidade", dimensions: "regiao,entidade",
      series: "divida_total_fornecedores_externos,divida_vencida_fornecedores_externos,pagamentos_em_atraso",
    }),
  health("sns-pregnancy-line-triage-feed", "SNS Grávida pregnancy-line triage",
    "Monthly pregnancy-line triages and referral destinations by local health unit, latest twenty-four reporting months.", {
      dataset: "evolucao-mensal-linha-sns-gravida", timeField: "mes", period: "month", windowPeriods: "24", orderBy: "mes DESC,uls", dimensions: "uls",
      series: "n_tt_triag_snsgrav,n_triag_snsgrav_ac,n_triag_snsgrav_csp,n_triag_snsgrav_cah,n_triag_snsgrav_su,n_triag_snsgrav_inem", units: "n_tt_triag_snsgrav=triages,n_triag_snsgrav_ac=triages,n_triag_snsgrav_csp=triages,n_triag_snsgrav_cah=triages,n_triag_snsgrav_su=triages,n_triag_snsgrav_inem=triages",
    }),
  health("sns-poison-information-calls-feed", "Poison information centre calls",
    "Monthly calls answered by the national poison information centre (CIAV), latest sixty reporting months.", {
      dataset: "evolucao-mensal-do-no-de-chamadas-atendidas-no-centro-de-informacao-antivenenos", timeField: "periodo", period: "month", windowPeriods: "60", orderBy: "periodo DESC", dimensions: "",
      series: "no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos", units: "no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos=calls",
    }),
  health("sns-licensed-public-defibrillator-programmes-feed", "Licensed public-space defibrillator programmes",
    "The complete published register of public-space defibrillator programmes, with establishment, address and reporting month. The portal's numeric record field is an identifier, not a count or a live AED availability measurement.", {
      dataset: "evolucao-programas-dae-licenciados-em-espacos-publicos", timeField: "tempo", orderBy: "tempo DESC,n_o_registos", idFields: "n_o_registos",
    }, MONTH),
  health("sns-medical-specialty-training-vacancies-feed", "Medical specialty training vacancies",
    "Available, filled and unfilled medical-internship specialty training places, latest three reporting years, preserved as records using the publisher's unique registo IDs. Some historical records share year, region, institution and specialty but report different counts without a cohort or revision label; these remain separate records rather than arbitrarily selected or summed series points.", {
      dataset: "vagas-formacao-especializada-internato", timeField: "periodo", period: "year", windowPeriods: "3", orderBy: "periodo DESC,regiao,instituicao,especialidade,registo", idFields: "registo",
      units: "vagas_disponiveis=places,vagas_ocupadas=places,vagas_nao_ocupadas=places",
    }, MONTH),
  health("sns-hospital-beds-by-type-feed", "Acute hospital beds by type",
    "Reported acute-care beds by hospital and bed type, latest twelve reporting months. A capacity breakdown, not the existing inpatient occupancy-rate product.", {
      dataset: "lotacao-praticada-por-tipo-de-cama", timeField: "tempo", period: "month", windowPeriods: "12", orderBy: "tempo DESC,regiao,instituicao,tipo_de_camas", dimensions: "regiao,instituicao,tipo_de_camas", series: "lotacao", units: "lotacao=beds",
    }),
  health("sns-legionella-environmental-monitoring-feed", "Environmental Legionella monitoring",
    "Annual INSA environmental Legionella sample counts by sampling context and test outcome. All published years; source totals and positive-result figures are preserved as reported.", {
      dataset: "monitorizacao-ambiental-de-legionella", timeField: "tempo", orderBy: "tempo DESC,ponto_ou_localizacao_geografica", dimensions: "ponto_ou_localizacao_geografica",
      series: "no_total_amostras_analisadas,no_total_amostras_rede_predial,no_total_amostras_aguas_de_processo_torres_de_arrefecimento,no_total_amostras_minerais_naturais_agua_termais,no_total_amostras_piscinas,no_total_amostras_positivas,no_total_amostras_positivas_que_excedem_o_valor_parametrico",
      units: "no_total_amostras_analisadas=samples,no_total_amostras_rede_predial=samples,no_total_amostras_aguas_de_processo_torres_de_arrefecimento=samples,no_total_amostras_minerais_naturais_agua_termais=samples,no_total_amostras_piscinas=samples,no_total_amostras_positivas=samples,no_total_amostras_positivas_que_excedem_o_valor_parametrico=samples",
    }, MONTH),
  health("sns-lvt-hospital-morbidity-mortality-feed", "Reported hospital morbidity and mortality figures in Lisbon and Tagus Valley",
    "Distinct source-reported inpatient days, hospitalisation rates and mortality rates by institution and diagnostic chapter in Região de Saúde LVT, latest reporting year. The portal includes conflicting unlabelled revisions for the same year/quarter/institution/chapter: these are preserved as separate figure records, not arbitrarily selected as a single time series. Report dates are discharge quarters; revision times and which figure is newest are unknown.", {
      dataset: "morbilidade-e-mortalidade-hospitalar", timeField: "ano", quarterField: "trimestre", period: "year", windowPeriods: "1", where: "regiao = 'Região de Saúde LVT'",
      select: "ano,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
      groupBy: "ano,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
      orderBy: "ano DESC,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade",
      idFields: "ano,trimestre,regiao,instituicao,cod_capitulo,desc_capitulo,taxa_internamento,dias_internamento,taxa_mortalidade", units: "dias_internamento=days",
    }),
  health("sns-first-consultations-within-target-feed", "First hospital consultations within the response target",
    "First hospital consultations delivered within the maximum response time, registered first consultations and the reported proportion within target, latest twenty-four reporting months by hospital.", {
      dataset: "consultas-em-tempo-real", timeField: "tempo", period: "month", windowPeriods: "24", orderBy: "tempo DESC,regiao,instituicao", dimensions: "regiao,instituicao",
      series: "no_primeiras_ce_prestadas_dentro_do_tmrg,no_primeiras_ce_realizadas_com_registo_no_cth,1as_consultas_realizadas_em_tempo_adequado", units: "no_primeiras_ce_prestadas_dentro_do_tmrg=consultations,no_primeiras_ce_realizadas_com_registo_no_cth=consultations",
    }),
  health("sns-cancer-screening-feed", "Cancer screening in primary care",
    "Reported breast, cervical and colorectal screening counts and proportions by primary-care area, latest twenty-four reporting months. Eligibility and look-back periods follow the source definitions.", {
      dataset: "rastreios-oncologicos", timeField: "tempo", period: "month", windowPeriods: "24", orderBy: "tempo DESC,regiao,area_csp", dimensions: "regiao,area_csp",
      series: "contagem_de_mulheres_com_registo_de_mamografia_nos_ultimos_dois_anos,proporcao_mulheres_50_70_a_c_mamogr_2_anos,contagem_de_mulheres_com_colpocitologia_atualizada,proporcao_mulheres_25_60_a_c_colpoc_atuali,contagem_de_utentes_inscritos_com_rastreio_do_cancro_do_colon_e_reto_efetuado,proporcao_utentes_50_75_a_c_rastreio_cancro_cr",
      units: "contagem_de_mulheres_com_registo_de_mamografia_nos_ultimos_dois_anos=women,contagem_de_mulheres_com_colpocitologia_atualizada=women,contagem_de_utentes_inscritos_com_rastreio_do_cancro_do_colon_e_reto_efetuado=patients",
    }),
];

function energy(slug: string, title: string, description: string, query: SourceConfig, cadenceSeconds = WEEK): ExampleFeed {
  return example(slug, title, description, query, "e-redes.opendatasoft.com", "E-REDES", "energy", cadenceSeconds);
}

function health(slug: string, title: string, description: string, query: SourceConfig, cadenceSeconds = WEEK): ExampleFeed {
  return example(slug, title, description, query, "transparencia.sns.gov.pt", "SNS Transparência", "health", cadenceSeconds);
}

function example(slug: string, title: string, description: string, query: SourceConfig, host: string, publisher: string, topic: string, cadenceSeconds: number): ExampleFeed {
  return {
    slug, title, description, publisher, topics: [topic],
    config: { source: "opendatasoft", host, limit: "10000", ...query },
    policy: {
      name: `${publisher} bounded reporting-period collection`, version: 1,
      collection: {
        cadenceSeconds, timeoutSeconds: 180, maxBytes: 8 * MEBIBYTE,
        maxOutputBytes: 16 * MEBIBYTE, maxRecordBytes: 512 * 1024, maxRecords: 20_000,
        historyMode: "changes",
      },
      serving: {
        licence: publisher === "E-REDES" ? "CC BY 4.0" : "Source terms not stated in the dataset metadata",
        attribution: publisher,
      },
    },
    staleAfterSeconds: cadenceSeconds * 2,
  };
}
