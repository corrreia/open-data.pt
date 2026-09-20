import type { ExampleFeed, Licence } from "../../index";

const LISBON_HOST = "services.arcgis.com";
const LISBON_SERVICE_ROOT = "1dSrzEWVQn5kHHyK/arcgis/rest/services";
const APA_HOST = "sniambgeoogc.apambiente.pt";
const APA_SERVICE_ROOT = "getogc/rest/services/SNIAmb";

/*
 * Lisboa states no licence on the ArcGIS services themselves: the service
 * metadata carries `copyrightText: "CM Lisboa 2026"` and no `licenseInfo` at
 * all. The terms live one step away, on the dados.gov.pt record for the same
 * service, and they are not uniform — 232 of the municipality's 316 datasets
 * are CC0, 83 are CC BY and one is ODC-PDDL. So each feed carries the licence
 * of the dataset its own service resolves to, and a feed whose service could
 * not be matched to exactly one record keeps `source-terms` rather than
 * inheriting a neighbour's terms.
 */
const LISBON_ATTRIBUTION = "Câmara Municipal de Lisboa — Lisboa Aberta";
const LISBON_POLICY = referencePolicy("ArcGIS daily reference layer", LISBON_ATTRIBUTION, "cc0-1.0");
const LISBON_CC_BY_POLICY = referencePolicy("ArcGIS daily reference layer, attributed", LISBON_ATTRIBUTION, "cc-by-4.0");
const LISBON_PDDL_POLICY = referencePolicy("ArcGIS daily reference layer, dedicated", LISBON_ATTRIBUTION, "odc-pddl");
/** Services that resolve to no single dados.gov.pt record, or to records under two different licences. */
const LISBON_UNSTATED_POLICY = referencePolicy("ArcGIS daily reference layer, terms unstated", LISBON_ATTRIBUTION, "source-terms");
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
/*
 * APA states no licence on the SNIAmb services either — `copyrightText` names
 * the agency and `licenseInfo` is absent — but every one of its 4,066 records
 * on dados.gov.pt, including all ten read here, is registered CC BY 4.0.
 */
const APA_POLICY = referencePolicy("APA daily reference layer", "Agência Portuguesa do Ambiente — SNIAmb", "cc-by-4.0");

/*
 * Mafra means these to be read: a folder named `Dados_Abertos` on the
 * municipality's own server, 52 feature services in it, and an open-data
 * portal at dadosabertos.cm-mafra.pt built on them. What it does not carry is
 * terms — every service answers with an empty `copyrightText` and no
 * `licenseInfo`, the portal states only "Copyright 2025. Município de Mafra",
 * and the municipality publishes nothing on dados.gov.pt to inherit terms
 * from. So these are served under the terms the source states, which is none.
 *
 * Two of the folder's layers are deliberately not read: its copy of the Carris
 * Metropolitana stops is that operator's data, already collected from the
 * operator, and its fuel stations are DGEG's.
 */
const MAFRA_HOST = "geomafra.cm-mafra.pt";
const MAFRA_SERVICE_ROOT = "arcgisext/rest/services/Dados_Abertos";
const MAFRA_POLICY = referencePolicy("Mafra daily reference layer", "Município de Mafra — Dados Abertos", "source-terms");

interface MafraLayer {
  service: string;
  layer: string;
  slug: string;
  title: string;
  description: string;
  topics: NonNullable<ExampleFeed["topics"]>;
}

const MAFRA_LAYERS: MafraLayer[] = [
  {
    service: "DadosAbertos_Amb_Ecopontos_Contentores",
    layer: "1",
    slug: "mafra-ecopontos-contentores",
    title: "Mafra recycling points",
    description:
      "Recycling points in Mafra, each naming the containers standing there for paper, packaging, glass, batteries, refuse, bio-waste, oil and textiles, with its street, locality and parish.",
    topics: ["environment", "cities"],
  },
  // Layer 2 of that same service holds the 8,635 containers themselves, one record each with
  // capacity and state of conservation, and is the richer half of the pair. It is a table
  // rather than a feature layer, and this library reads layers: it requires a geometry type
  // and a table declares none. Read it once tables are supported, not by pretending it has one.
  {
    service: "DadosAbertos_Amb_Espacos_Verdes",
    layer: "3",
    slug: "mafra-espacos-verdes",
    title: "Mafra green spaces",
    description: "Green spaces in Mafra with their code, the place and locality they lie in, the space they belong to, and the parish.",
    topics: ["environment", "cities"],
  },
  {
    service: "DadosAbertos_Amb_Parques_Caninos",
    layer: "0",
    slug: "mafra-parques-caninos",
    title: "Mafra dog parks",
    description: "Dog parks in Mafra with their address, the equipment and drinking fountains they hold, the year each was built, who built and maintains it, and its paving.",
    topics: ["cities", "society"],
  },
  {
    service: "DadosAbertos_Postos_Carregamento_Eletrico",
    layer: "0",
    slug: "mafra-postos-carregamento",
    title: "Mafra electric-vehicle charging points",
    description:
      "Charging points in Mafra with their operator, the kind of charge and number of chargers, the form of operation, and the licence and contract periods each runs under.",
    topics: ["energy", "mobility"],
  },
  {
    service: "DadosAbertos_Transito_Estacionamento_Bicicletas",
    layer: "0",
    slug: "mafra-estacionamento-bicicletas",
    title: "Mafra bicycle parking",
    description: "Bicycle parking in Mafra with its location, parish and the observations recorded for it.",
    topics: ["mobility", "cities"],
  },
  {
    service: "DadosAbertos_Transito_Parques_Estacionamento",
    layer: "0",
    slug: "mafra-parques-estacionamento",
    title: "Mafra parking areas",
    description: "Parking areas in Mafra with their designation, the number of spaces each holds, whether those spaces are charged for, the address and the parish.",
    topics: ["mobility", "cities"],
  },
  {
    service: "DadosAbertos_Transito_Parcometros",
    layer: "0",
    slug: "mafra-parcometros",
    title: "Mafra parking meters",
    description: "Parking meters in Mafra with the hours they apply on weekdays, Saturdays and Sundays, the tariff, and the least and greatest amount each takes.",
    topics: ["mobility", "cities"],
  },
  {
    service: "DadosAbertos_Transito_Lugares_Mobilidade_Reduzida",
    layer: "0",
    slug: "mafra-lugares-mobilidade-reduzida",
    title: "Mafra reduced-mobility parking bays",
    description: "Parking bays reserved for reduced mobility in Mafra, with the street and traffic codes, the locality and parish, and the date each sign was placed.",
    topics: ["mobility", "society"],
  },
  {
    service: "DadosAbertos_Desp_Ciclovias",
    layer: "0",
    slug: "mafra-ciclovias",
    title: "Mafra cycle lanes",
    description: "Cycle lanes in Mafra with their name, typology, and whether each is a principal route.",
    topics: ["mobility", "cities"],
  },
  {
    service: "DadosAbertos_Desp_CircuitosPedestres_BTT",
    layer: "0",
    slug: "mafra-circuitos-pedestres-btt",
    title: "Mafra walking and mountain-bike trails",
    description: "Walking and mountain-bike trails in Mafra with their name, description and type.",
    topics: ["society", "environment"],
  },
  {
    service: "DadosAbertos_Cult_Patrimonio_Inventario_Total",
    layer: "0",
    slug: "mafra-patrimonio-inventario",
    title: "Mafra heritage inventory",
    description: "The municipal heritage inventory of Mafra: each item's designation, address, period, category and the situation it is in.",
    topics: ["culture", "cities"],
  },
  {
    service: "DadosAbertos_Educa_Equip_Escolares",
    layer: "0",
    slug: "mafra-equipamentos-escolares",
    title: "Mafra schools",
    description: "Schools in Mafra with their address, parish, contacts, typology, capacity, opening hours and the grouping each belongs to.",
    topics: ["society", "cities"],
  },
  {
    service: "DadosAbertos_Equip_Saude",
    layer: "1",
    slug: "mafra-centros-saude",
    title: "Mafra health centres",
    description: "Health centres in Mafra with their address, parish, contacts, hours of operation and service shifts.",
    topics: ["health", "cities"],
  },
  {
    service: "DadosAbertos_Equip_Farmacias",
    layer: "1",
    slug: "mafra-farmacias",
    title: "Mafra pharmacies",
    description: "Pharmacies in Mafra with their address, parish, contacts, hours of operation and duty shifts.",
    topics: ["health", "cities"],
  },
  {
    service: "DadosAbertos_ASocial_Equipamentos_Sociais",
    layer: "1",
    slug: "mafra-equipamentos-sociais",
    title: "Mafra social facilities",
    description: "Social facilities in Mafra with their address and parish, their legal nature, the services each offers and the capacity it holds.",
    topics: ["society", "cities"],
  },
  {
    service: "DadosAbertos_Equip_Esp_Jogo_Recreio",
    layer: "0",
    slug: "mafra-espacos-jogo-recreio",
    title: "Mafra play areas",
    description: "Play and recreation areas in Mafra with their name, address, locality, parish and type.",
    topics: ["society", "cities"],
  },
  {
    service: "DadosAbertos_Equipamentos_Coletivos_Cultura",
    layer: "0",
    slug: "mafra-equipamentos-cultura",
    title: "Mafra cultural facilities",
    description: "Cultural bodies and facilities in Mafra with their typology, category, name and location.",
    topics: ["culture", "cities"],
  },
  {
    service: "DadosAbertos_Tur_Praias",
    layer: "0",
    slug: "mafra-praias",
    title: "Mafra beaches",
    description: "Beaches in Mafra and the distinctions each holds: Blue Flag, accessible beach, healthy beach, gold quality, zero pollution and surf reserve.",
    topics: ["environment", "society"],
  },
];

export const ARCGIS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "lisboa-rede-ciclavel-feed",
    title: "Lisboa cycling network",
    description: "Cycle-network line segments published by Lisboa Aberta.",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/Ciclovias/FeatureServer`,
      layer: "0",
    },
    policy: LISBON_CC_BY_POLICY,
    staleAfterSeconds: 172_800,
    publisher: "cm-lisboa",
    topics: ["cities"],
  },
  {
    slug: "lisboa-ecoilhas-subterraneas-feed",
    title: "Lisboa underground recycling islands",
    description: "Locations and attributes of underground recycling islands in Lisboa.",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/Amb_EcopontosSubterraneos/FeatureServer`,
      layer: "0",
    },
    policy: LISBON_POLICY,
    staleAfterSeconds: 172_800,
    publisher: "cm-lisboa",
    topics: ["cities"],
  },
  {
    slug: "lisboa-parques-caninos-feed",
    title: "Lisboa dog parks",
    description: "Boundaries and public information for dog parks in Lisboa.",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/ParquesCaninos/FeatureServer`,
      layer: "0",
    },
    policy: LISBON_POLICY,
    staleAfterSeconds: 172_800,
    publisher: "cm-lisboa",
    topics: ["cities"],
  },
  {
    slug: "lisboa-parques-infantis-feed",
    title: "Lisboa playgrounds",
    description: "Locations and management details for playgrounds in Lisboa.",
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/POIArLivre/FeatureServer`,
      layer: "2",
    },
    policy: LISBON_POLICY,
    staleAfterSeconds: 172_800,
    publisher: "cm-lisboa",
    topics: ["cities"],
  },
  lisbonExample("lisbon-health-centres-feed", "Lisbon health centres", "Locations and contact details for public health centres in Lisbon.", "POISaude", "0"),
  lisbonExample("lisbon-metro-stations-feed", "Lisbon metro stations", "Locations and public information for metro stations in Lisbon.", "POITransportes", "1"),
  lisbonExample("lisbon-primary-schools-feed", "Lisbon public primary schools", "Locations and contact details for public first-cycle schools in Lisbon.", "POIEducacao", "12"),
  lisbonExample("lisbon-museums-feed", "Lisbon museums", "Locations, contacts, and public information for museums in Lisbon.", "POICultura", "3"),
  lisbonExample(
    "lisbon-micromobility-restrictions-feed",
    "Lisbon micromobility parking restriction zones",
    "Areas in Lisbon where authorised micromobility operators may not leave vehicles parked.",
    "MOB_Micromobilidade",
    "0",
    LISBON_UNSTATED_POLICY,
  ),
  lisbonExample(
    "lisbon-signalised-crossings-feed",
    "Lisbon signalised crossings",
    "Locations and boundaries of road crossings controlled by traffic lights in Lisbon.",
    "CruzamentosSemaforizados",
    "0",
    LISBON_PDDL_POLICY,
  ),
  lisbonExample("lisbon-lora-network-feed", "Lisbon LoRa network sites", "Locations of municipal LoRa network sites in Lisbon.", "Rede_LoRa", "0"),
  lisbonExample(
    "lisbon-sports-facilities-feed",
    "Lisbon sports facilities",
    "Locations, types, and managing organisations for sports facilities in Lisbon.",
    "Desporto_Instalacoes",
    "0",
  ),
  lisbonExample(
    "lisbon-libraries-archives-feed",
    "Lisbon libraries and archives",
    "Locations, contacts, and public information for libraries, archives, and documentation centres in Lisbon.",
    "EquipamentosCulturais",
    "1",
    LISBON_UNSTATED_POLICY,
  ),
  lisbonExample(
    "lisbon-recycling-points-feed",
    "Lisbon recycling points",
    "Locations and collection details for public recycling points in Lisbon.",
    "Amb_Reciclagem",
    "2",
    LISBON_UNSTATED_POLICY,
  ),
  lisbonExample("lisbon-cleaning-depots-feed", "Lisbon street-cleaning depots", "Locations of municipal street-cleaning depots in Lisbon.", "Amb_Limpeza", "1"),
  lisbonExample(
    "lisbon-tree-incidents-feed",
    "Lisbon reported tree incidents",
    "Locations and current details for tree incidents published by Lisbon municipality.",
    "Incidentes_Arv",
    "0",
  ),
  lisbonExample(
    "lisbon-parishes-feed",
    "Lisbon parish boundaries",
    "Boundaries and identifiers for the 24 civil parishes of Lisbon.",
    "Base_Freguesias",
    "0",
    LISBON_UNSTATED_POLICY,
  ),
  lisbonExample("lisbon-tuk-tuk-parking-feed", "Lisbon tuk-tuk parking areas", "Designated tuk-tuk parking locations in Lisbon.", "TukTukEstacionamentos", "0"),
  apaExample(
    "apa-bathing-beaches-feed",
    "Portugal bathing beaches",
    "Bathing-season dates, water-quality classification, facilities, and public information links for Portuguese beaches.",
    "Praias",
  ),
  apaExample(
    "apa-air-quality-stations-feed",
    "Portugal air quality monitoring stations",
    "Locations and site details for stations in the national air-quality monitoring network.",
    "Qualidade_do_Ar",
  ),
  apaExample(
    "apa-hydrometric-stations-feed",
    "Portugal hydrometric stations",
    "Locations, operating status, station type, and public data links for hydrometric stations.",
    "Estacoes_hidrometricas",
  ),
  apaExample(
    "apa-meteorological-stations-feed",
    "Portugal meteorological stations",
    "Locations, operating status, station type, and public data links for meteorological stations.",
    "Estacoes_meteorologicas",
  ),
  apaExample(
    "apa-radnet-stations-feed",
    "Portugal RADNET radiation monitoring stations",
    "Locations and site details for the national airborne radioactivity alert network.",
    "RADNET",
  ),
  apaExample("apa-flood-marks-feed", "Portugal historical flood marks", "Locations, dates, recorded flood elevations, and sources for historical flood marks.", "Marcas_cheias"),
  lisbonExample("lisbon-speed-cameras-feed", "Lisbon speed cameras", "Locations of fixed speed cameras on Lisbon roads.", "MOB_RadaresPaineis", "0"),
  lisbonExample(
    "lisbon-variable-message-signs-feed",
    "Lisbon variable message signs",
    "Locations of electronic road signs that show traffic messages in Lisbon.",
    "MOB_RadaresPaineis",
    "1",
  ),
  lisbonExample(
    "lisbon-temporary-occupations-feed",
    "Lisbon licensed temporary use of public space",
    "Licensed events and temporary occupations of public space in Lisbon, with dates and parish.",
    "UCT_OcupacoesTemporariasEspacoPublico",
    "0",
    LISBON_UNSTATED_POLICY,
  ),
  lisbonExample("lisbon-pharmacies-feed", "Lisbon pharmacies", "Locations and contact details for pharmacies in Lisbon.", "POISaude", "1"),
  lisbonExample("lisbon-public-hospitals-feed", "Lisbon public hospitals", "Locations and contact details for public hospitals in Lisbon.", "POISaude", "4"),
  lisbonExample("lisbon-fire-stations-feed", "Lisbon fire stations", "Locations of fire brigade stations in Lisbon.", "POISocorro", "1"),
  lisbonExample(
    "lisbon-psp-police-stations-feed",
    "Lisbon PSP police stations",
    "Locations and contact details for Public Security Police stations in Lisbon.",
    "POISeguranca",
    "1",
  ),
  lisbonExample(
    "lisbon-urgent-works-feed",
    "Lisbon urgent public works",
    "Locations of urgent public works carried out by Lisbon municipality.",
    "DCIEP_OBRAS_25_gdb",
    "1",
    LISBON_UNSTATED_POLICY,
  ),
  lisbonExample("lisbon-hotels-feed", "Lisbon hotels", "Locations and classification of hotels in Lisbon.", "Alojamento", "0"),
  {
    ...lisbonExample(
      "lisbon-building-permits-feed",
      "Lisbon building and demolition permits",
      "Permits issued for building and demolition works in Lisbon, with dates, addresses, and parcel outlines.",
      "AlvarasObras",
      "0",
    ),
    policy: LISBON_PERMITS_POLICY,
  },
  apaExample("apa-bathing-waters-feed", "Portugal bathing waters", "Identified coastal and inland bathing waters, with their classification and location.", "Aguas_Balneares"),
  apaExample("apa-blue-flag-beaches-feed", "Portugal Blue Flag beaches", "Beaches awarded the Blue Flag for the current bathing season.", "Praias", "2"),
  apaExample(
    "apa-seveso-establishments-feed",
    "Establishments under major-accident prevention rules",
    "Industrial sites covered by the Seveso major-accident prevention regime (Decree-Law 150/2015).",
    "Prevencao_Acidentes_Graves",
  ),
  apaExample(
    "apa-emissions-trading-installations-feed",
    "Installations in the EU emissions trading system",
    "Portuguese installations covered by the EU greenhouse gas emissions trading system.",
    "CELE",
  ),
  ...MAFRA_LAYERS.map(mafraExample),
];

function lisbonExample(slug: string, title: string, description: string, service: string, layer: string, policy: ExampleFeed["policy"] = LISBON_POLICY): ExampleFeed {
  return {
    slug,
    title,
    description,
    config: {
      source: "arcgis",
      host: LISBON_HOST,
      service: `${LISBON_SERVICE_ROOT}/${service}/FeatureServer`,
      layer,
    },
    policy,
    staleAfterSeconds: 172_800,
    publisher: "cm-lisboa",
    topics: ["cities"],
  };
}

function apaExample(slug: string, title: string, description: string, service: string, layer = "0"): ExampleFeed {
  return {
    slug,
    title,
    description,
    config: {
      source: "arcgis",
      host: APA_HOST,
      service: `${APA_SERVICE_ROOT}/${service}/MapServer`,
      layer,
    },
    policy: APA_POLICY,
    staleAfterSeconds: 172_800,
    publisher: "apa",
    topics: ["environment"],
  };
}

function mafraExample(layer: MafraLayer): ExampleFeed {
  return {
    slug: `${layer.slug}-feed`,
    title: layer.title,
    description: layer.description,
    config: {
      source: "arcgis",
      host: MAFRA_HOST,
      service: `${MAFRA_SERVICE_ROOT}/${layer.service}/FeatureServer`,
      layer: layer.layer,
    },
    policy: MAFRA_POLICY,
    staleAfterSeconds: 172_800,
    publisher: "cm-mafra",
    topics: layer.topics,
  };
}

function referencePolicy(name: string, attribution: string, licence: Licence): ExampleFeed["policy"] {
  return {
    name,
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 60,
      maxBytes: 5 * 1024 * 1024,
      historyMode: "changes" as const,
    },
    serving: {
      licence,
      attribution,
    },
  };
}
