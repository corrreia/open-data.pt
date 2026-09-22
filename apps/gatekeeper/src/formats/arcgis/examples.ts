import type { ExampleFeed } from "../../index";

const LISBON_HOST = "services.arcgis.com";
const LISBON_SERVICE_ROOT = "1dSrzEWVQn5kHHyK/arcgis/rest/services";
const APA_HOST = "sniambgeoogc.apambiente.pt";
const APA_SERVICE_ROOT = "getogc/rest/services/SNIAmb";

const LISBON_POLICY = referencePolicy("ArcGIS daily reference layer");
const LISBON_CC_BY_POLICY = referencePolicy("ArcGIS daily reference layer, attributed");
const LISBON_PDDL_POLICY = referencePolicy("ArcGIS daily reference layer, dedicated");
const LISBON_UNSTATED_POLICY = referencePolicy("ArcGIS daily reference layer, terms unstated");
// The permits layer is about 12,000 parcel outlines, roughly 13 MB of GeoJSON.
const LISBON_PERMITS_POLICY = {
  ...LISBON_POLICY,
  name: "ArcGIS daily large reference layer",
  collection: {
    ...LISBON_POLICY.collection,
    timeoutSeconds: 180,
    maxBytes: 24 * 1024 * 1024,
  },
};
const APA_POLICY = referencePolicy("APA daily reference layer");

/*
 * Mafra means these to be read: a folder named `Dados_Abertos` on the
 * municipality's own server, 52 feature services in it, and an open-data
 * portal at dadosabertos.cm-mafra.pt built on them.
 *
 * Two of the folder's layers are deliberately not read: its copy of the Carris
 * Metropolitana stops is that operator's data, already collected from the
 * operator, and its fuel stations are DGEG's.
 */
const MAFRA_HOST = "geomafra.cm-mafra.pt";
const MAFRA_SERVICE_ROOT = "arcgisext/rest/services/Dados_Abertos";
const MAFRA_POLICY = referencePolicy("Mafra daily reference layer");

/** One layer of a Lisboa service. Where several feeds read one dataset, each says what it is within it. */
interface LisbonLayer {
  slug: string;
  /** The dataset this feed reads, a key of `DATASETS`. */
  dataset: string;
  /** What this feed is within its dataset, where the dataset holds more than one. */
  title?: string;
  description?: string;
  service: string;
  layer: string;
  /** The terms the service resolves to decide which policy it is served under; the plain one otherwise. */
  policy?: ExampleFeed["policy"];
}

/** One layer of an APA SNIAmb service, read the same way. */
interface ApaLayer {
  slug: string;
  dataset: string;
  title?: string;
  description?: string;
  service: string;
  /** The layer within the map service, where it is not the first. */
  layer?: string;
}

interface MafraLayer {
  service: string;
  layer: string;
  slug: string;
  /** The dataset this layer is, a key of `DATASETS`. */
  dataset: string;
}

const MAFRA_LAYERS: MafraLayer[] = [
  {
    service: "DadosAbertos_Amb_Ecopontos_Contentores",
    layer: "1",
    slug: "mafra-ecopontos-contentores",
    dataset: "cm-mafra-ecopontos-contentores",
  },
  // Layer 2 of that same service holds the 8,635 containers themselves, one record each with
  // capacity and state of conservation, and is the richer half of the pair. It is a table
  // rather than a feature layer, and this library reads layers: it requires a geometry type
  // and a table declares none. Read it once tables are supported, not by pretending it has one.
  {
    service: "DadosAbertos_Amb_Espacos_Verdes",
    layer: "3",
    slug: "mafra-espacos-verdes",
    dataset: "cm-mafra-espacos-verdes",
  },
  {
    service: "DadosAbertos_Amb_Parques_Caninos",
    layer: "0",
    slug: "mafra-parques-caninos",
    dataset: "cm-mafra-parques-caninos",
  },
  {
    service: "DadosAbertos_Postos_Carregamento_Eletrico",
    layer: "0",
    slug: "mafra-postos-carregamento",
    dataset: "cm-mafra-postos-carregamento",
  },
  {
    service: "DadosAbertos_Transito_Estacionamento_Bicicletas",
    layer: "0",
    slug: "mafra-estacionamento-bicicletas",
    dataset: "cm-mafra-estacionamento-bicicletas",
  },
  {
    service: "DadosAbertos_Transito_Parques_Estacionamento",
    layer: "0",
    slug: "mafra-parques-estacionamento",
    dataset: "cm-mafra-parques-estacionamento",
  },
  {
    service: "DadosAbertos_Transito_Parcometros",
    layer: "0",
    slug: "mafra-parcometros",
    dataset: "cm-mafra-parcometros",
  },
  {
    service: "DadosAbertos_Transito_Lugares_Mobilidade_Reduzida",
    layer: "0",
    slug: "mafra-lugares-mobilidade-reduzida",
    dataset: "cm-mafra-lugares-mobilidade-reduzida",
  },
  {
    service: "DadosAbertos_Desp_Ciclovias",
    layer: "0",
    slug: "mafra-ciclovias",
    dataset: "cm-mafra-ciclovias",
  },
  {
    service: "DadosAbertos_Desp_CircuitosPedestres_BTT",
    layer: "0",
    slug: "mafra-circuitos-pedestres-btt",
    dataset: "cm-mafra-circuitos-pedestres-btt",
  },
  {
    service: "DadosAbertos_Cult_Patrimonio_Inventario_Total",
    layer: "0",
    slug: "mafra-patrimonio-inventario",
    dataset: "cm-mafra-patrimonio-inventario",
  },
  {
    service: "DadosAbertos_Educa_Equip_Escolares",
    layer: "0",
    slug: "mafra-equipamentos-escolares",
    dataset: "cm-mafra-equipamentos-escolares",
  },
  {
    service: "DadosAbertos_Equip_Saude",
    layer: "1",
    slug: "mafra-centros-saude",
    dataset: "cm-mafra-centros-saude",
  },
  {
    service: "DadosAbertos_Equip_Farmacias",
    layer: "1",
    slug: "mafra-farmacias",
    dataset: "cm-mafra-farmacias",
  },
  {
    service: "DadosAbertos_ASocial_Equipamentos_Sociais",
    layer: "1",
    slug: "mafra-equipamentos-sociais",
    dataset: "cm-mafra-equipamentos-sociais",
  },
  {
    service: "DadosAbertos_Equip_Esp_Jogo_Recreio",
    layer: "0",
    slug: "mafra-espacos-jogo-recreio",
    dataset: "cm-mafra-espacos-jogo-recreio",
  },
  {
    service: "DadosAbertos_Equipamentos_Coletivos_Cultura",
    layer: "0",
    slug: "mafra-equipamentos-cultura",
    dataset: "cm-mafra-equipamentos-cultura",
  },
  {
    service: "DadosAbertos_Tur_Praias",
    layer: "0",
    slug: "mafra-praias",
    dataset: "cm-mafra-praias",
  },
];

export const ARCGIS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "lisboa-rede-ciclavel-feed",
    dataset: "cm-lisboa-rede-ciclavel",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/Ciclovias/FeatureServer`,
      layer: "0",
    },
    policy: LISBON_CC_BY_POLICY,
    staleAfterSeconds: 172_800,
  },
  {
    slug: "lisboa-ecoilhas-subterraneas-feed",
    dataset: "cm-lisboa-ecoilhas-subterraneas",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/Amb_EcopontosSubterraneos/FeatureServer`,
      layer: "0",
    },
    policy: LISBON_POLICY,
    staleAfterSeconds: 172_800,
  },
  {
    slug: "lisboa-parques-caninos-feed",
    dataset: "cm-lisboa-parques-caninos",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/ParquesCaninos/FeatureServer`,
      layer: "0",
    },
    policy: LISBON_POLICY,
    staleAfterSeconds: 172_800,
  },
  {
    slug: "lisboa-parques-infantis-feed",
    dataset: "cm-lisboa-parques-infantis",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/POIArLivre/FeatureServer`,
      layer: "2",
    },
    policy: LISBON_POLICY,
    staleAfterSeconds: 172_800,
  },
  /*
   * The health-centre dataset is read by three feeds — centres, pharmacies and
   * hospitals are three layers of one service, keyed and served alike — so each
   * says what it is within it.
   */
  lisbonExample({
    slug: "lisbon-health-centres-feed",
    dataset: "cm-lisboa-health-centres",
    title: "Lisbon health centres",
    description: "Locations and contact details for public health centres in Lisbon.",
    service: "POISaude",
    layer: "0",
  }),
  lisbonExample({ slug: "lisbon-metro-stations-feed", dataset: "cm-lisboa-metro-stations", service: "POITransportes", layer: "1" }),
  lisbonExample({ slug: "lisbon-primary-schools-feed", dataset: "cm-lisboa-primary-schools", service: "POIEducacao", layer: "12" }),
  lisbonExample({ slug: "lisbon-museums-feed", dataset: "cm-lisboa-museums", service: "POICultura", layer: "3" }),
  lisbonExample({
    slug: "lisbon-micromobility-restrictions-feed",
    dataset: "cm-lisboa-micromobility-restrictions",
    service: "MOB_Micromobilidade",
    layer: "0",
    policy: LISBON_UNSTATED_POLICY,
  }),
  lisbonExample({
    slug: "lisbon-signalised-crossings-feed",
    dataset: "cm-lisboa-signalised-crossings",
    service: "CruzamentosSemaforizados",
    layer: "0",
    policy: LISBON_PDDL_POLICY,
  }),
  lisbonExample({ slug: "lisbon-lora-network-feed", dataset: "cm-lisboa-lora-network", service: "Rede_LoRa", layer: "0" }),
  lisbonExample({ slug: "lisbon-sports-facilities-feed", dataset: "cm-lisboa-sports-facilities", service: "Desporto_Instalacoes", layer: "0" }),
  lisbonExample({
    slug: "lisbon-libraries-archives-feed",
    dataset: "cm-lisboa-libraries-archives",
    service: "EquipamentosCulturais",
    layer: "1",
    policy: LISBON_UNSTATED_POLICY,
  }),
  lisbonExample({ slug: "lisbon-recycling-points-feed", dataset: "cm-lisboa-recycling-points", service: "Amb_Reciclagem", layer: "2", policy: LISBON_UNSTATED_POLICY }),
  lisbonExample({ slug: "lisbon-cleaning-depots-feed", dataset: "cm-lisboa-cleaning-depots", service: "Amb_Limpeza", layer: "1" }),
  lisbonExample({ slug: "lisbon-tree-incidents-feed", dataset: "cm-lisboa-tree-incidents", service: "Incidentes_Arv", layer: "0" }),
  lisbonExample({ slug: "lisbon-parishes-feed", dataset: "cm-lisboa-parishes", service: "Base_Freguesias", layer: "0", policy: LISBON_UNSTATED_POLICY }),
  lisbonExample({ slug: "lisbon-tuk-tuk-parking-feed", dataset: "cm-lisboa-tuk-tuk-parking", service: "TukTukEstacionamentos", layer: "0" }),
  apaExample({
    slug: "apa-bathing-beaches-feed",
    dataset: "apa-bathing-beaches",
    title: "Portugal bathing beaches",
    description: "Bathing-season dates, water-quality classification, facilities, and public information links for Portuguese beaches.",
    service: "Praias",
  }),
  apaExample({ slug: "apa-air-quality-stations-feed", dataset: "apa-air-quality-stations", service: "Qualidade_do_Ar" }),
  apaExample({ slug: "apa-hydrometric-stations-feed", dataset: "apa-hydrometric-stations", service: "Estacoes_hidrometricas" }),
  apaExample({ slug: "apa-meteorological-stations-feed", dataset: "apa-meteorological-stations", service: "Estacoes_meteorologicas" }),
  apaExample({ slug: "apa-radnet-stations-feed", dataset: "apa-radnet-stations", service: "RADNET" }),
  apaExample({ slug: "apa-flood-marks-feed", dataset: "apa-flood-marks", service: "Marcas_cheias" }),
  /*
   * The radars and the message panels are two layers of one service, and one
   * dataset: each says which of the two it is.
   */
  lisbonExample({
    slug: "lisbon-speed-cameras-feed",
    dataset: "cm-lisboa-speed-cameras",
    title: "Lisbon speed cameras",
    description: "Locations of fixed speed cameras on Lisbon roads.",
    service: "MOB_RadaresPaineis",
    layer: "0",
  }),
  lisbonExample({
    slug: "lisbon-variable-message-signs-feed",
    dataset: "cm-lisboa-speed-cameras",
    title: "Lisbon variable message signs",
    description: "Locations of electronic road signs that show traffic messages in Lisbon.",
    service: "MOB_RadaresPaineis",
    layer: "1",
  }),
  lisbonExample({
    slug: "lisbon-temporary-occupations-feed",
    dataset: "cm-lisboa-temporary-occupations",
    service: "UCT_OcupacoesTemporariasEspacoPublico",
    layer: "0",
    policy: LISBON_UNSTATED_POLICY,
  }),
  lisbonExample({
    slug: "lisbon-pharmacies-feed",
    dataset: "cm-lisboa-health-centres",
    title: "Lisbon pharmacies",
    description: "Locations and contact details for pharmacies in Lisbon.",
    service: "POISaude",
    layer: "1",
  }),
  lisbonExample({
    slug: "lisbon-public-hospitals-feed",
    dataset: "cm-lisboa-health-centres",
    title: "Lisbon public hospitals",
    description: "Locations and contact details for public hospitals in Lisbon.",
    service: "POISaude",
    layer: "4",
  }),
  lisbonExample({ slug: "lisbon-fire-stations-feed", dataset: "cm-lisboa-fire-stations", service: "POISocorro", layer: "1" }),
  lisbonExample({ slug: "lisbon-psp-police-stations-feed", dataset: "cm-lisboa-psp-police-stations", service: "POISeguranca", layer: "1" }),
  lisbonExample({ slug: "lisbon-urgent-works-feed", dataset: "cm-lisboa-urgent-works", service: "DCIEP_OBRAS_25_gdb", layer: "1", policy: LISBON_UNSTATED_POLICY }),
  lisbonExample({ slug: "lisbon-hotels-feed", dataset: "cm-lisboa-hotels", service: "Alojamento", layer: "0" }),
  lisbonExample({ slug: "lisbon-building-permits-feed", dataset: "cm-lisboa-building-permits", service: "AlvarasObras", layer: "0", policy: LISBON_PERMITS_POLICY }),
  apaExample({ slug: "apa-bathing-waters-feed", dataset: "apa-bathing-waters", service: "Aguas_Balneares" }),
  apaExample({
    slug: "apa-blue-flag-beaches-feed",
    dataset: "apa-bathing-beaches",
    title: "Portugal Blue Flag beaches",
    description: "Beaches awarded the Blue Flag for the current bathing season.",
    service: "Praias",
    layer: "2",
  }),
  apaExample({ slug: "apa-seveso-establishments-feed", dataset: "apa-seveso-establishments", service: "Prevencao_Acidentes_Graves" }),
  apaExample({ slug: "apa-emissions-trading-installations-feed", dataset: "apa-emissions-trading-installations", service: "CELE" }),
  ...MAFRA_LAYERS.map(mafraExample),
];

function lisbonExample(layer: LisbonLayer): ExampleFeed {
  const example: ExampleFeed = {
    slug: layer.slug,
    dataset: layer.dataset,
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/${layer.service}/FeatureServer`,
      layer: layer.layer,
    },
    policy: layer.policy ?? LISBON_POLICY,
    staleAfterSeconds: 172_800,
  };
  if (layer.title) example.title = layer.title;
  if (layer.description) example.description = layer.description;
  return example;
}

function apaExample(layer: ApaLayer): ExampleFeed {
  const example: ExampleFeed = {
    slug: layer.slug,
    dataset: layer.dataset,
    config: {
      source: "arcgis",
      host: APA_HOST,
      service: `${APA_SERVICE_ROOT}/${layer.service}/MapServer`,
      layer: layer.layer ?? "0",
    },
    policy: APA_POLICY,
    staleAfterSeconds: 172_800,
  };
  if (layer.title) example.title = layer.title;
  if (layer.description) example.description = layer.description;
  return example;
}

function mafraExample(layer: MafraLayer): ExampleFeed {
  return {
    slug: `${layer.slug}-feed`,
    dataset: layer.dataset,
    config: {
      source: "arcgis",
      host: MAFRA_HOST,
      service: `${MAFRA_SERVICE_ROOT}/${layer.service}/FeatureServer`,
      layer: layer.layer,
    },
    policy: MAFRA_POLICY,
    staleAfterSeconds: 172_800,
  };
}

function referencePolicy(name: string): ExampleFeed["policy"] {
  return {
    name,
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 60,
      maxBytes: 5 * 1024 * 1024,
      historyMode: "changes" as const,
    },
  };
}
