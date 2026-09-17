import type { ExampleFeed, SourceConfig } from "../../index";

/** The Porto portal moved to dadosabertos.cm-porto.pt in September 2026; opendata.porto.digital no longer resolves. */
const PORTO_HOST = "dadosabertos.cm-porto.pt";

const SERVING = {
  licence: "Creative Commons CCZero",
  attribution: `Câmara Municipal do Porto via ${PORTO_HOST}`,
} as const;

const DAILY_REFERENCE = {
  name: "Porto CKAN daily reference snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 60,
    maxBytes: 10 * 1024 * 1024,
    historyMode: "changes",
  },
  serving: SERVING,
} as const;

const CASCAIS_DAILY_REFERENCE = {
  ...DAILY_REFERENCE,
  name: "Cascais CKAN daily reference snapshot",
  serving: {
    ...SERVING,
    licence: "Creative Commons Attribution (CC BY)",
    attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  },
} as const;

const DAILY_CHANGES = {
  ...DAILY_REFERENCE,
  name: "Porto CKAN daily event changes",
} as const;

export const CKAN_EXAMPLES: ExampleFeed[] = [
  {
    slug: "porto-municipal-parking-feed",
    title: "Porto municipal car parks",
    description: "Municipal car parks, capacities, management, and opening hours.",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "parques-de-estacionamento-municipais",
      resource: "e9898000-f437-42d3-8c5b-22c5594052b2",
    },
    policy: DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
    publisher: "Câmara Municipal do Porto",
    topics: ["cities", "mobility"],
  },
  {
    slug: "porto-municipal-trees-feed",
    title: "Porto municipal trees",
    description: "Identified municipal trees with species, age range, and source geometry.",
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
    publisher: "Câmara Municipal do Porto",
    topics: ["cities", "environment"],
  },
  // Porto's museums and thematic centres (cultura-cultura-museus) did not survive the
  // September 2026 move to dadosabertos.cm-porto.pt: the re-imported catalog of 69
  // datasets carries no museum inventory under any name. Restore the example when the
  // municipality publishes one again.
  {
    slug: "porto-cultural-agenda-feed",
    title: "Porto cultural agenda",
    description: "Published cultural events with descriptions, schedules, and locations.",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "apd-pontos-de-interesse-cultura-e-patrimonio-agenda-cultural",
      resource: "e246f08d-b4d0-4955-ae82-07b516c4c747",
    },
    policy: DAILY_CHANGES,
    staleAfterSeconds: 172_800,
    publisher: "Câmara Municipal do Porto",
    topics: ["cities", "culture"],
  },
  {
    slug: "porto-loading-zones-feed",
    title: "Porto loading and unloading zones",
    description: "Kerbside loading and unloading bays with their location and rules.",
    config: {
      source: "ckan",
      host: PORTO_HOST,
      dataset: "cargas-e-descargas",
      resource: "51dc9778-0735-428e-9b26-d08fc06eb5bf",
    },
    policy: DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
    publisher: "Câmara Municipal do Porto",
    topics: ["cities", "mobility"],
  },
  cascaisExample(
    "cascais-pharmacies-feed",
    "Cascais pharmacies",
    "Pharmacies in Cascais with addresses and locations.",
    "geocascais-farmacias",
    "94238d3f-4832-4927-977e-22e82940a9d9",
    ["cities", "health"],
  ),
  cascaisExample(
    "cascais-defibrillators-feed",
    "Cascais public defibrillators",
    "Locations of automated external defibrillators available to the public in Cascais.",
    "geocascais-desfibrilhador",
    "073e2257-3bb8-4065-a503-a901dff66295",
    ["cities", "health"],
  ),
  cascaisExample(
    "cascais-health-facilities-feed",
    "Cascais health facilities",
    "Health centres, hospitals, and other health facilities in Cascais.",
    "geocascais-equipamentosaude",
    "1f32f448-7ea4-4d16-a64b-9e4eb4fffa12",
    ["cities", "health"],
  ),
  cascaisExample(
    "cascais-shared-mobility-stations-feed",
    "Cascais shared mobility stations",
    "Stations for shared bicycles and scooters in Cascais.",
    "geocascais-estacaopartilhamicromobilidade",
    "6b19cc5b-7e82-4ba5-b5b0-747725a99b4e",
    ["cities", "mobility"],
  ),
  cascaisExample(
    "cascais-bus-stops-feed",
    "Cascais bus stops",
    "Bus stops in Cascais with their location and shelter details.",
    "geocascais-paragemautocarro",
    "a5375dc1-824a-48ec-b7e3-8030d5543285",
    ["cities", "mobility"],
  ),
  cascaisExample(
    "cascais-train-stations-feed",
    "Cascais train stations",
    "Railway stations on the Cascais line within the municipality.",
    "geocascais-estacaocomboios",
    "86545ad5-30a4-45c6-a311-e4a6d01d6762",
    ["cities", "mobility"],
  ),
  cascaisExample(
    "cascais-taxi-ranks-feed",
    "Cascais taxi ranks",
    "Taxi ranks in Cascais with their location and number of places.",
    "geocascais-pracataxis",
    "7c2f6153-f9f9-488d-867c-ceb050e48d43",
    ["cities", "mobility"],
  ),
  cascaisExample("cascais-cycle-paths-feed", "Cascais cycle paths", "Cycle path segments in Cascais.", "geocascais-ciclovia", "74649057-6245-4214-a68c-d4acc3753b7d", [
    "cities",
    "mobility",
  ]),
  cascaisExample(
    "cascais-forest-fires-feed",
    "Cascais forest fire areas",
    "Areas burnt by recorded forest fires in Cascais, with their dates.",
    "geocascais-incendioflorestal",
    "062d1d34-dce0-4a5a-bae1-99cc7f124bcf",
    ["cities", "environment"],
  ),
  cascaisExample(
    "cascais-fire-stations-feed",
    "Cascais fire stations",
    "Fire brigade stations in Cascais.",
    "geocascais-quartelbombeiros",
    "8b4c8466-3df8-439c-9b3d-c5419395e916",
    ["cities", "society"],
  ),
  cascaisExample(
    "cascais-tsunami-meeting-points-feed",
    "Cascais tsunami meeting points",
    "Evacuation meeting points to use in case of a tsunami warning in Cascais.",
    "geocascais-pontosencontrotsunami",
    "f6c7b517-7663-4f7c-bcd9-2db8cfab5036",
    ["cities", "environment", "society"],
  ),
  cascaisExample("cascais-beaches-feed", "Cascais beaches", "Beaches in Cascais with their location and facilities.", "geocascais-praia", "0ba066ff-383d-484b-baf6-a7769c2316dd", [
    "cities",
    "environment",
  ]),
  cascaisExample(
    "cascais-drinking-fountains-feed",
    "Cascais drinking fountains",
    "Public drinking fountains in Cascais.",
    "geocascais-bebedouro",
    "271d3e44-c0d0-4123-85ff-5c5fc2db6c22",
    ["cities"],
  ),
  cascaisExample(
    "cascais-markets-feed",
    "Cascais fairs and markets",
    "Municipal fairs and markets in Cascais with their location.",
    "geocascais-feiramercado",
    "52ac6f20-e436-4270-93c7-35d2529da157",
    ["cities", "economy"],
  ),
  cascaisExample("cascais-playgrounds-feed", "Cascais playgrounds", "Public playgrounds in Cascais.", "geocascais-parqueinfantil", "684f9e58-2c4f-4f5b-b0a1-a5455acbed64", [
    "cities",
  ]),
  cascaisExample(
    "cascais-public-schools-feed",
    "Cascais public schools",
    "Public schools in Cascais with their education level and location.",
    "geocascais-estabelecimentoescolar",
    "b7b1fef2-960c-4934-a912-92f026ffd000",
    ["cities", "society"],
  ),
  cascaisExample(
    "cascais-hotels-feed",
    "Cascais hotels",
    "Hotels and other tourist accommodation units in Cascais.",
    "geocascais-unidadehoteleira",
    "16f33130-4504-4304-9517-e02b1442025d",
    ["cities", "economy"],
  ),
  cascaisExample(
    "cascais-cultural-venues-feed",
    "Cascais cultural venues",
    "Museums, theatres, libraries, and other cultural venues in Cascais.",
    "geocascais-equipamentocultural",
    "9b899d53-8e7f-4d61-bac1-86449853a87b",
    ["cities", "culture"],
  ),
  aguedaExample(
    "flood-marks",
    "Águeda flood-level reference marks",
    "Surveyed flood-height reference marks, not current river levels or flood warnings.",
    "cotas-de-cheia",
    "51ebb54b-0249-46b6-8aa9-edf5365a9976",
    { idField: "gid", crs: "EPSG:3763" },
    ["cities", "environment"],
    "Creative Commons Attribution (CC BY)",
  ),
  aguedaExample(
    "waste-bins",
    "Águeda municipal waste-bin locations",
    "Municipal solid-waste container location inventory. No live bin fullness is provided.",
    "contentores-rsu",
    "5ec1ab1d-998b-41f5-b35d-860d63ec869c",
    { idField: "id", crs: "EPSG:3763" },
    ["cities", "environment"],
  ),
  aguedaExample(
    "textile-bins",
    "Águeda textile collection-bin locations",
    "Textile recycling container location inventory, not live capacity or fullness.",
    "f2f9d71f-ffab-4678-b4a1-6a2709879020",
    "df073fc9-441e-4385-b50e-0290881a5729",
    { idField: "id", crs: "EPSG:3763" },
    ["cities", "environment"],
    "Creative Commons Attribution (CC BY)",
  ),
  aguedaExample(
    "electronics-bins",
    "Águeda electronics collection-bin locations",
    "Electrical and electronic waste collection points, not live capacity or fullness.",
    "contentores-reee",
    "a7963739-44fd-47ec-b9bf-481141cfcda5",
    { idField: "id", crs: "EPSG:3763" },
    ["cities", "environment"],
    "Creative Commons Attribution (CC BY)",
  ),
  aguedaExample(
    "waste-operators",
    "Águeda waste-management operators",
    "Reference locations and published details of waste-management establishments.",
    "b2d1563d-683f-4dff-a472-a68789c9df74",
    "4a836cd0-eed9-4ecd-b9fc-ebeee1323aae",
    { idField: "id_ogr" },
    ["cities", "environment"],
  ),
  aguedaExample(
    "charging-locations",
    "Águeda electric-vehicle charging locations",
    "Published charging-point location inventory and technical details. This is not live charging availability.",
    "ponto-de-carregamento-de-veiculos-eletricos",
    "8a0e420f-ebe4-452c-956f-870427811bcd",
    { idField: "id_pontocve" },
    ["cities", "mobility", "energy"],
  ),
  aguedaExample(
    "beagueda-stations",
    "beÁgueda bicycle station locations",
    "Reference locations and dock capacities of beÁgueda bicycle stations, not live bicycle or dock availability.",
    "estacoes-beagueda",
    "c6da7509-f4b1-4a3c-a39b-5af5e4908288",
    { idField: "id" },
    ["cities", "mobility"],
  ),
  {
    slug: "oeiras-hourly-environment-feed",
    title: "Oeiras hourly air quality, noise and weather",
    description:
      "Hourly QART station measurements from the latest published monthly CSV. Monthly publication, not live observations; timestamps and units are those supplied by the municipality.",
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
      serving: { licence: "Creative Commons Attribution (CC BY)", attribution: "Câmara Municipal de Oeiras via oeirasinterativa.oeiras.pt" },
    },
    staleAfterSeconds: 45 * 86_400,
    publisher: "Câmara Municipal de Oeiras",
    topics: ["cities", "environment"],
  },
];

/** One slowly changing municipal location inventory, with no live availability claim. */
function aguedaExample(
  slug: string,
  title: string,
  description: string,
  dataset: string,
  resource: string,
  options: SourceConfig,
  topics: string[],
  licence = "Creative Commons CCZero",
): ExampleFeed {
  return {
    slug: `agueda-${slug}-feed`,
    title,
    description,
    config: { source: "ckan", host: "dadosabertos.cm-agueda.pt", dataset, resource, ...options },
    policy: {
      name: "Águeda municipal reference inventory, monthly",
      // Reconfigure the two feeds whose initial origin requests exhausted retries.
      version: slug === "textile-bins" || slug === "waste-operators" ? 2 : 1,
      collection: { cadenceSeconds: 30 * 86_400, timeoutSeconds: 90, maxBytes: 4 * 1024 * 1024, historyMode: "changes" },
      serving: { licence, attribution: "Câmara Municipal de Águeda via dadosabertos.cm-agueda.pt" },
    },
    staleAfterSeconds: 90 * 86_400,
    publisher: "Câmara Municipal de Águeda",
    topics,
  };
}

/** One GeoJSON resource from the Cascais open data portal, collected daily. */
function cascaisExample(slug: string, title: string, description: string, dataset: string, resource: string, topics: string[]): ExampleFeed {
  return {
    slug,
    title,
    description,
    config: { source: "ckan", host: "dadosabertos.cascais.pt", dataset, resource },
    policy: CASCAIS_DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
    publisher: "Câmara Municipal de Cascais",
    topics,
  };
}
