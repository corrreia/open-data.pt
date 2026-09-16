import type { CollectionPolicyDefinition, ExampleFeed, ServingPolicyDefinition } from "../../index";

const MEBIBYTE = 1024 * 1024;
const DGT_HOST = "ogcapi.dgterritorio.gov.pt";
const AZORES_HOST = "ambiente.azores.gov.pt";
const AZORES_BASE_PATH = "idea-api";

const WEEK = 604_800;
const MONTH = 2_592_000;

/**
 * The CAOP is republished as a dated edition, not continuously; the Azores
 * layers are inventories that change when a diploma or a survey does. Weekly is
 * frequent enough to catch a correction on the collections that cost almost
 * nothing to read, and the tens-of-megabyte outlines are read monthly.
 */
const DGT_SERVING: ServingPolicyDefinition = {
  // DGT publishes no reuse licence with these collections: the service links
  // only its SNIG catalogue record. Nothing here may be invented.
  licence: "Source terms apply",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
};

/** Every Azores collection links `rel="license"` to CC BY 4.0 in its own collection description. */
const AZORES_SERVING: ServingPolicyDefinition = {
  licence: "CC BY 4.0",
  attribution: "Secretaria Regional do Ambiente e Ação Climática — Governo dos Açores (IDEA)",
};

/** Attribute tables: a few hundred kilobytes at most, every property on every feature. */
function attributePolicy(name: string, serving: ServingPolicyDefinition, maxBytes: number): ExampleFeed["policy"] {
  return {
    name,
    version: 3,
    collection: {
      cadenceSeconds: WEEK,
      timeoutSeconds: 120,
      maxBytes,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving,
  };
}

/**
 * Feature outlines. `maxRecordBytes` is raised to the kernel's own ceiling
 * because a single island park or geosite outline is several hundred kilobytes;
 * it was measured, not guessed, and a feature past it is rejected rather than
 * silently truncated, which leaves the product partial.
 */
function outlinePolicy(name: string, serving: ServingPolicyDefinition, maxBytes: number, maxOutputBytes: number, cadenceSeconds: number): ExampleFeed["policy"] {
  return {
    name,
    version: 3,
    collection: {
      cadenceSeconds,
      timeoutSeconds: 180,
      maxBytes,
      maxOutputBytes,
      maxRecordBytes: MEBIBYTE,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving,
  };
}

export const OGC_EXAMPLES: ExampleFeed[] = [
  /*
   * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
   * municipalities and 3,049 parishes, with the Azores and Madeira absent from
   * these collections. Every title and description says so.
   *
   * They are collected without geometry. One district outline reaches 3.6 MB
   * and two municipal outlines pass 1 MB, which is the largest record the
   * platform stores; the whole municipal layer is 49 MB of coordinates that
   * would be re-read and re-compared on every collection. `skipGeometry` is a
   * documented OGC API Features parameter, the product page says the feed asks
   * for attributes only, and every feature is still published: the scope is
   * complete, only the shape is left at the source.
   */
  {
    slug: "dgt-caop-distritos-feed",
    title: "Mainland Portugal district reference table (CAOP 2025)",
    description:
      "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "distritos",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "DGT · Direção-Geral do Território",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-municipios-feed",
    title: "Mainland Portugal municipality reference table (CAOP 2025)",
    description:
      "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "municipios",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "DGT · Direção-Geral do Território",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-freguesias-feed",
    title: "Mainland Portugal parish reference table (CAOP 2025)",
    description:
      "The 3,049 civil parishes of mainland Portugal in the official administrative charter: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "freguesias",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 8 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "DGT · Direção-Geral do Território",
    topics: ["society"],
  },

  /* The Azores regional environment agency: nine islands, outlines included. */
  {
    slug: "azores-farois-feed",
    title: "Azores lighthouses",
    description: "Lighthouses of the Azores archipelago, located from coastal management plans and orthophoto interpretation.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Farois",
      geometry: "include",
      pageSize: "500",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", AZORES_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "Governo dos Açores",
    topics: ["environment", "mobility"],
  },
  {
    slug: "azores-operadores-residuos-feed",
    title: "Azores waste management operators",
    description: "Installations of licensed waste management operators in the Azores, with address, island and the regional waste information system listing each entry came from.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Operadores_GestaoResiduos",
      geometry: "include",
      pageSize: "500",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", AZORES_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "Governo dos Açores",
    topics: ["environment"],
  },
  {
    slug: "azores-estacoes-qualidade-ar-feed",
    title: "Azores air quality monitoring stations",
    description:
      "Where the Azores air quality monitoring stations are, who runs them, and when each entry was last updated. This is the station inventory, not the measurements those stations take.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "RedeMonitorizacao_QualidadeAr",
      geometry: "include",
      pageSize: "500",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", AZORES_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "Governo dos Açores",
    topics: ["environment"],
  },
  {
    slug: "azores-rede-hidrometeorologica-feed",
    title: "Azores hydrometeorological monitoring stations",
    description:
      "The rain gauges, weather posts and stream gauges of the Azores hydrometeorological network, with type, operator and operating state. This is the station inventory, not the measurements those stations take.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Rede_Hidrometeorologica",
      geometry: "include",
      pageSize: "500",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", AZORES_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "Governo dos Açores",
    topics: ["environment", "weather"],
  },
  {
    slug: "azores-lagoas-feed",
    title: "Azores lakes and lagoons",
    description: "Lakes and lagoons of Corvo, Faial, Flores, Pico, São Jorge, Terceira and São Miguel, with altitude, depth, volume and outline.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Lagoas",
      geometry: "include",
      pageSize: "100",
      maxPages: "6",
    },
    policy: outlinePolicy("OGC weekly feature outlines", AZORES_SERVING, 8 * MEBIBYTE, 8 * MEBIBYTE, WEEK),
    staleAfterSeconds: 1_209_600,
    publisher: "Governo dos Açores",
    topics: ["environment"],
  },
  {
    slug: "azores-zonas-especiais-conservacao-feed",
    title: "Azores special areas of conservation",
    description: "The Natura 2000 special areas of conservation of the Azores, with their site codes, the instruments that designated them, and their outlines.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Zonas_EspeciaisConservacao",
      geometry: "include",
      pageSize: "50",
      maxPages: "6",
    },
    policy: outlinePolicy("OGC monthly feature outlines", AZORES_SERVING, 16 * MEBIBYTE, 8 * MEBIBYTE, MONTH),
    staleAfterSeconds: 5_184_000,
    publisher: "Governo dos Açores",
    topics: ["environment"],
  },
  {
    slug: "azores-geossitios-feed",
    title: "Azores geosites",
    description:
      "The geosites of the Açores UNESCO Global Geopark across the nine islands and two marine areas, with relevance, uses, vulnerability ratings, description and outline.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Geositios",
      geometry: "include",
      pageSize: "50",
      maxPages: "8",
    },
    policy: outlinePolicy("OGC monthly feature outlines", AZORES_SERVING, 32 * MEBIBYTE, 12 * MEBIBYTE, MONTH),
    staleAfterSeconds: 5_184_000,
    publisher: "Governo dos Açores",
    topics: ["environment", "culture"],
  },
  {
    slug: "azores-parques-naturais-feed",
    title: "Azores island natural parks",
    description:
      "The protected areas of the island natural parks of the Azores, with IUCN category, the regional decree that created each one, its World Database on Protected Areas identifier, and its outline.",
    config: {
      source: "ogc",
      host: AZORES_HOST,
      basePath: AZORES_BASE_PATH,
      collection: "Parques_NaturaisIlha",
      geometry: "include",
      pageSize: "50",
      maxPages: "8",
    },
    policy: outlinePolicy("OGC monthly feature outlines", AZORES_SERVING, 48 * MEBIBYTE, 16 * MEBIBYTE, MONTH),
    staleAfterSeconds: 5_184_000,
    publisher: "Governo dos Açores",
    topics: ["environment"],
  },
];
