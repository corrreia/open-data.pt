import type { ExampleFeed } from "../../index";

const LISBON_HOST = "services.arcgis.com";
const LISBON_SERVICE_ROOT = "1dSrzEWVQn5kHHyK/arcgis/rest/services";
const APA_HOST = "sniambgeoogc.apambiente.pt";
const APA_SERVICE_ROOT = "getogc/rest/services/SNIAmb";

const LISBON_POLICY = referencePolicy("ArcGIS daily reference layer", "Câmara Municipal de Lisboa — Lisboa Aberta");
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
const APA_POLICY = referencePolicy("APA daily reference layer", "Agência Portuguesa do Ambiente — SNIAmb");

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
    policy: LISBON_POLICY,
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
  ),
  lisbonExample(
    "lisbon-signalised-crossings-feed",
    "Lisbon signalised crossings",
    "Locations and boundaries of road crossings controlled by traffic lights in Lisbon.",
    "CruzamentosSemaforizados",
    "0",
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
  ),
  lisbonExample("lisbon-recycling-points-feed", "Lisbon recycling points", "Locations and collection details for public recycling points in Lisbon.", "Amb_Reciclagem", "2"),
  lisbonExample("lisbon-cleaning-depots-feed", "Lisbon street-cleaning depots", "Locations of municipal street-cleaning depots in Lisbon.", "Amb_Limpeza", "1"),
  lisbonExample(
    "lisbon-tree-incidents-feed",
    "Lisbon reported tree incidents",
    "Locations and current details for tree incidents published by Lisbon municipality.",
    "Incidentes_Arv",
    "0",
  ),
  lisbonExample("lisbon-parishes-feed", "Lisbon parish boundaries", "Boundaries and identifiers for the 24 civil parishes of Lisbon.", "Base_Freguesias", "0"),
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
  lisbonExample("lisbon-urgent-works-feed", "Lisbon urgent public works", "Locations of urgent public works carried out by Lisbon municipality.", "DCIEP_OBRAS_25_gdb", "1"),
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
];

function lisbonExample(slug: string, title: string, description: string, service: string, layer: string): ExampleFeed {
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
    policy: LISBON_POLICY,
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

function referencePolicy(name: string, attribution: string): ExampleFeed["policy"] {
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
      licence: "source-terms",
      attribution,
    },
  };
}
