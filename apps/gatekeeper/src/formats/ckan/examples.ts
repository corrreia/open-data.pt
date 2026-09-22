import type { ExampleFeed, SourceConfig } from "../../index";

/** The Porto portal moved to dadosabertos.cm-porto.pt in September 2026; opendata.porto.digital no longer resolves. */
const PORTO_HOST = "dadosabertos.cm-porto.pt";

const DAILY_REFERENCE = {
  name: "Porto CKAN daily reference snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 60,
    maxBytes: 10 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

const CASCAIS_DAILY_REFERENCE = {
  ...DAILY_REFERENCE,
  name: "Cascais CKAN daily reference snapshot",
} as const;

const DAILY_CHANGES = {
  ...DAILY_REFERENCE,
  name: "Porto CKAN daily event changes",
} as const;

export const CKAN_EXAMPLES: ExampleFeed[] = [
  {
    slug: "porto-municipal-parking-feed",
    dataset: "cm-porto-municipal-parking",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "parques-de-estacionamento-municipais",
      resource: "e9898000-f437-42d3-8c5b-22c5594052b2",
    },
    policy: DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
  },
  {
    slug: "porto-municipal-trees-feed",
    dataset: "cm-porto-municipal-trees",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto",
      resource: "ed573cc6-3c01-462d-b136-f6a4d059e9a6",
    },
    // About 72,000 trees: the 6.5 MB CSV normalizes to more than the 16 MiB default output cap.
    policy: {
      ...DAILY_REFERENCE,
      name: "Porto CKAN daily large reference snapshot",
      collection: { ...DAILY_REFERENCE.collection, timeoutSeconds: 180, maxOutputBytes: 64 * 1024 * 1024 },
    },
    staleAfterSeconds: 604_800,
  },
  // Porto's museums and thematic centres (cultura-cultura-museus) did not survive the
  // September 2026 move to dadosabertos.cm-porto.pt: the re-imported catalog of 69
  // datasets carries no museum inventory under any name. Restore the example when the
  // municipality publishes one again.
  {
    slug: "porto-cultural-agenda-feed",
    dataset: "cm-porto-cultural-agenda",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "apd-pontos-de-interesse-cultura-e-patrimonio-agenda-cultural",
      resource: "e246f08d-b4d0-4955-ae82-07b516c4c747",
    },
    policy: DAILY_CHANGES,
    staleAfterSeconds: 172_800,
  },
  {
    slug: "porto-loading-zones-feed",
    dataset: "cm-porto-loading-zones",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "cargas-e-descargas",
      resource: "51dc9778-0735-428e-9b26-d08fc06eb5bf",
    },
    policy: DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
  },
  cascaisExample("cascais-pharmacies-feed", "cm-cascais-pharmacies", "geocascais-farmacias", "94238d3f-4832-4927-977e-22e82940a9d9"),
  cascaisExample("cascais-defibrillators-feed", "cm-cascais-defibrillators", "geocascais-desfibrilhador", "073e2257-3bb8-4065-a503-a901dff66295"),
  cascaisExample("cascais-health-facilities-feed", "cm-cascais-health-facilities", "geocascais-equipamentosaude", "1f32f448-7ea4-4d16-a64b-9e4eb4fffa12"),
  cascaisExample(
    "cascais-shared-mobility-stations-feed",
    "cm-cascais-shared-mobility-stations",
    "geocascais-estacaopartilhamicromobilidade",
    "6b19cc5b-7e82-4ba5-b5b0-747725a99b4e",
  ),
  cascaisExample("cascais-bus-stops-feed", "cm-cascais-bus-stops", "geocascais-paragemautocarro", "a5375dc1-824a-48ec-b7e3-8030d5543285"),
  cascaisExample("cascais-train-stations-feed", "cm-cascais-train-stations", "geocascais-estacaocomboios", "86545ad5-30a4-45c6-a311-e4a6d01d6762"),
  cascaisExample("cascais-taxi-ranks-feed", "cm-cascais-taxi-ranks", "geocascais-pracataxis", "7c2f6153-f9f9-488d-867c-ceb050e48d43"),
  cascaisExample("cascais-cycle-paths-feed", "cm-cascais-cycle-paths", "geocascais-ciclovia", "74649057-6245-4214-a68c-d4acc3753b7d"),
  cascaisExample("cascais-parking-feed", "cm-cascais-parking", "geocascais-estacionamento", "a052d6cc-5120-4ede-a2e6-dd707022660d"),
  cascaisTreeExample("cascais-street-trees-feed", "cm-cascais-street-trees", "geocascais-arvore", "25bce551-91b3-4f58-8737-82a3eaabd93a"),
  // The companion register of felled and transplanted trees (geocascais-arvoreintervencao)
  // is not read: its CSV streams past 48 MB and keeps growing, because it is an append-only
  // log of every intervention ever made. It is the portal's largest file by some way and the
  // least rewarding per byte. Read it if Cascais ever publishes it cut by year.
  cascaisExample("cascais-green-spaces-feed", "cm-cascais-green-spaces", "geocascais-estruturaverde", "1814aa71-ab3b-4b19-8038-5f8c779ebd8c"),
  cascaisExample("cascais-municipal-housing-feed", "cm-cascais-municipal-housing", "geocascais-habitacaomunicipal", "35e169ef-c209-4f44-971a-aba56990cbf4"),
  cascaisExample("cascais-allotments-feed", "cm-cascais-allotments", "geocascais-horta", "67f6aa56-49b2-4d15-b81c-825d449acb9c"),
  cascaisExample("cascais-fire-infrastructure-feed", "cm-cascais-fire-infrastructure", "geocascais-infraestruturacombincendios", "b9cc4104-7c2f-4195-aa95-f84622554289"),
  cascaisExample("cascais-sports-facilities-feed", "cm-cascais-sports-facilities", "geocascais-equipamentodesportivo", "de595b77-b9b3-45d7-abd5-cf1a0ab98439"),
  cascaisExample("cascais-rental-kiosks-feed", "cm-cascais-rental-kiosks", "geocascais-mobilidadesuave", "1fc3ad4f-2b6b-4779-ba9f-5c90b6260012"),
  cascaisExample("cascais-commerce-services-feed", "cm-cascais-commerce-services", "geocascais-comercioservico", "1f30c5fa-acb7-4cab-859e-f0e549999609"),
  cascaisExample("cascais-social-charter-feed", "cm-cascais-social-charter", "geocascais-cartasocial", "18220143-de7f-42d0-a121-33fbaf00fb65"),
  cascaisExample("cascais-forest-fires-feed", "cm-cascais-forest-fires", "geocascais-incendioflorestal", "062d1d34-dce0-4a5a-bae1-99cc7f124bcf"),
  cascaisExample("cascais-fire-stations-feed", "cm-cascais-fire-stations", "geocascais-quartelbombeiros", "8b4c8466-3df8-439c-9b3d-c5419395e916"),
  cascaisExample("cascais-tsunami-meeting-points-feed", "cm-cascais-tsunami-meeting-points", "geocascais-pontosencontrotsunami", "f6c7b517-7663-4f7c-bcd9-2db8cfab5036"),
  cascaisExample("cascais-beaches-feed", "cm-cascais-beaches", "geocascais-praia", "0ba066ff-383d-484b-baf6-a7769c2316dd"),
  cascaisExample("cascais-drinking-fountains-feed", "cm-cascais-drinking-fountains", "geocascais-bebedouro", "271d3e44-c0d0-4123-85ff-5c5fc2db6c22"),
  cascaisExample("cascais-markets-feed", "cm-cascais-markets", "geocascais-feiramercado", "52ac6f20-e436-4270-93c7-35d2529da157"),
  cascaisExample("cascais-playgrounds-feed", "cm-cascais-playgrounds", "geocascais-parqueinfantil", "684f9e58-2c4f-4f5b-b0a1-a5455acbed64"),
  cascaisExample("cascais-public-schools-feed", "cm-cascais-public-schools", "geocascais-estabelecimentoescolar", "b7b1fef2-960c-4934-a912-92f026ffd000"),
  cascaisExample("cascais-hotels-feed", "cm-cascais-hotels", "geocascais-unidadehoteleira", "16f33130-4504-4304-9517-e02b1442025d"),
  cascaisExample("cascais-cultural-venues-feed", "cm-cascais-cultural-venues", "geocascais-equipamentocultural", "9b899d53-8e7f-4d61-bac1-86449853a87b"),
  aguedaExample("flood-marks", "cm-agueda-flood-marks", "cotas-de-cheia", "51ebb54b-0249-46b6-8aa9-edf5365a9976", { idField: "gid", crs: "EPSG:3763" }),
  aguedaExample("waste-bins", "cm-agueda-waste-bins", "contentores-rsu", "5ec1ab1d-998b-41f5-b35d-860d63ec869c", { idField: "id", crs: "EPSG:3763" }),
  aguedaExample("textile-bins", "cm-agueda-textile-bins", "f2f9d71f-ffab-4678-b4a1-6a2709879020", "df073fc9-441e-4385-b50e-0290881a5729", { idField: "id", crs: "EPSG:3763" }),
  aguedaExample("electronics-bins", "cm-agueda-electronics-bins", "contentores-reee", "a7963739-44fd-47ec-b9bf-481141cfcda5", { idField: "id", crs: "EPSG:3763" }),
  aguedaExample("waste-operators", "cm-agueda-waste-operators", "b2d1563d-683f-4dff-a472-a68789c9df74", "4a836cd0-eed9-4ecd-b9fc-ebeee1323aae", { idField: "id_ogr" }),
  aguedaExample("charging-locations", "cm-agueda-charging-locations", "ponto-de-carregamento-de-veiculos-eletricos", "8a0e420f-ebe4-452c-956f-870427811bcd", {
    idField: "id_pontocve",
  }),
  aguedaExample("beagueda-stations", "cm-agueda-beagueda-stations", "estacoes-beagueda", "c6da7509-f4b1-4a3c-a39b-5af5e4908288", { idField: "id" }),
  {
    slug: "oeiras-hourly-environment-feed",
    dataset: "cm-oeiras-hourly-environment",
    config: {
      source: "ckan",
      host: "oeirasinterativa.oeiras.pt",
      apiPath: "/dadosabertos",
      dataset: "sensorizacao-relatorios-mensais-com-dados-de-qualidade-do-ar-pressao-sonora-e-meteorologia",
      resourceSelection: "latest-month",
      resourcePrefix: "qart_dados_medias_1h_",
      timeField: "Date",
      delimiter: ";",
      decimal: ",",
      measures: JSON.stringify({
        "CO - µg/m3": "µg/m³",
        "O3 - µg/m3": "µg/m³",
        "NO - µg/m3": "µg/m³",
        "NO2 - µg/m3": "µg/m³",
        "SO2 - µg/m3": "µg/m³",
        "Humidade - %": "%",
        "Temperatura - ℃": "°C",
        "PM 0.5 - µg/m3": "µg/m³",
        "PM 0.7 - µg/m3": "µg/m³",
        "PM 1 - µg/m3": "µg/m³",
        "PM 2.5 - µg/m3": "µg/m³",
        "PM 10 - µg/m3": "µg/m³",
        "LAeq,T - dB(A)": "dB(A)",
        "Velocidade do Vento - m/s": "m/s",
        "Direção do Vento - °": "°",
        "Pressão - mbar": "mbar",
        "Precipitação - mm": "mm",
      }),
    },
    policy: {
      name: "Oeiras monthly observations checked weekly",
      version: 1,
      collection: { cadenceSeconds: 604_800, timeoutSeconds: 90, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 45 * 86_400,
  },
];

/** One slowly changing municipal location inventory, with no live availability claim. */
function aguedaExample(slug: string, dataset: string, portalDataset: string, resource: string, options: SourceConfig): ExampleFeed {
  return {
    slug: `agueda-${slug}-feed`,
    dataset,
    config: { source: "ckan", host: "dadosabertos.cm-agueda.pt", dataset: portalDataset, resource, ...options },
    policy: {
      name: "Águeda municipal reference inventory, monthly",
      // Reconfigure the two feeds whose initial origin requests exhausted retries.
      version: slug === "textile-bins" || slug === "waste-operators" ? 2 : 1,
      collection: { cadenceSeconds: 30 * 86_400, timeoutSeconds: 90, maxBytes: 4 * 1024 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 90 * 86_400,
  };
}

/** One GeoJSON resource from the Cascais open data portal, collected daily. */
function cascaisExample(slug: string, dataset: string, portalDataset: string, resource: string): ExampleFeed {
  return {
    slug,
    dataset,
    config: { source: "ckan", host: "dadosabertos.cascais.pt", dataset: portalDataset, resource },
    policy: CASCAIS_DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
  };
}

/**
 * The two tree registers, which are the portal's largest files by an order of
 * magnitude: 25 MB of outlines for the standing trees and 37 MB for the felled
 * and transplanted ones. Cascais rebuilds every export nightly, but a tree
 * inventory is not a nightly fact, so these are read weekly — enough to catch
 * a season's felling, and a thirtieth of the bytes a daily read would cost.
 */
function cascaisTreeExample(slug: string, dataset: string, portalDataset: string, resource: string): ExampleFeed {
  return {
    ...cascaisExample(slug, dataset, portalDataset, resource),
    policy: {
      ...CASCAIS_DAILY_REFERENCE,
      name: "Cascais CKAN weekly large reference snapshot",
      collection: {
        ...CASCAIS_DAILY_REFERENCE.collection,
        cadenceSeconds: 604_800,
        timeoutSeconds: 300,
        maxBytes: 48 * 1024 * 1024,
        maxOutputBytes: 192 * 1024 * 1024,
      },
    },
    staleAfterSeconds: 1_209_600,
  };
}
