import type { ExampleFeed } from "../../index";
import { WFS_MAX_BYTES } from "./wfs";

/*
 * The APPS layer is national — 22,631 parcels, about 22 MB of attributes — but
 * a Gatekeeper buffers a reference layer whole, under a 16 MB cap that no feed
 * policy may raise. So it is read one district at a time: every parcel and
 * every attribute is still published, and the largest district, Aveiro, is
 * about 11 MB. These eight are the districts the approved sub-regional
 * programmes cover; the other ten answer with no parcels at all.
 */
const APPS_DISTRICTS = ["Aveiro", "Beja", "Braga", "Leiria", "Lisboa", "Porto", "Setúbal", "Viseu"] as const;

/*
 * Oeiras publishes a `dados_abertos` workspace of 240 feature types on its own
 * GeoServer, stating Fees NONE and AccessConstraints NONE in its capabilities
 * and CC BY on the CKAN records beside it. Almost none of those layers carries
 * an identifier column — an inventory of road works names a street, a state
 * and a contractor, and nothing that tells one row from the next — so they are
 * keyed by the identity the service gives each feature, which this GeoServer
 * derives from the key of the table behind the layer and returns in that order.
 */
const OEIRAS_HOST = "oeirasinterativa.oeiras.pt";
const OEIRAS_PATH = "/gis/services/dados_abertos/wfs";
const OEIRAS_ATTRIBUTION = "Câmara Municipal de Oeiras — Oeiras Interativa";

interface OeirasLayer {
  layer: string;
  slug: string;
  title: string;
  description: string;
  topics: NonNullable<ExampleFeed["topics"]>;
  /** The layer's own key, where it has one; otherwise the service's feature identity. */
  idField?: string;
  numberFields?: string;
  dateFields?: string;
  dateOnlyFields?: string;
}

const OEIRAS_LAYERS: OeirasLayer[] = [
  {
    layer: "w_condicionalismos_via_publica",
    slug: "oeiras-condicionalismos-via-publica",
    title: "Oeiras public-road restrictions",
    description:
      "Every works restriction on the public road in Oeiras: what the work is, where it is, who asked for it, the state it has reached, the dates it was expected to start and finish, and when the record was last touched.",
    topics: ["cities", "mobility"],
    dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
    dateFields: "ultima_atualizacao",
  },
  {
    layer: "w_obras_municipais",
    slug: "oeiras-obras-municipais",
    title: "Oeiras municipal works",
    description:
      "The municipality's own works programme: each work's name, place, classification and type, the state it has reached, and the dates it is expected to start and finish.",
    topics: ["cities"],
    dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
    dateFields: "ultima_atualizacao",
  },
  {
    layer: "w_parquimetros",
    slug: "oeiras-parquimetros",
    title: "Oeiras parking meters",
    description: "Parking meters in Oeiras with their tariff, zone and sub-zone, street, parish, whether a weekly price applies, and the date each was surveyed.",
    topics: ["cities", "mobility"],
    dateOnlyFields: "data_levantamento",
  },
  {
    layer: "w_pontos_carregamento",
    slug: "oeiras-pontos-carregamento",
    title: "Oeiras electric-vehicle charging points",
    description: "Charging points in Oeiras with their MOBI.E identifier, operator, charging power, voltage level, connector format and sockets.",
    topics: ["energy", "mobility"],
  },
  {
    layer: "w_ciclovias",
    slug: "oeiras-ciclovias",
    title: "Oeiras cycle network",
    description:
      "The cycle network of Oeiras segment by segment: its designation, typology and degree of segregation from traffic, its condition, length in metres, where it starts and ends, and the points of interest it serves.",
    topics: ["mobility", "cities"],
    // `data_construcao` is written day-first ("21/09/2002"), which is not a date this
    // library parses, so it is kept as the text the service publishes.
    numberFields: "extensao_m",
  },
  {
    layer: "w_espacos_verdes",
    slug: "oeiras-espacos-verdes",
    title: "Oeiras green spaces",
    description: "Green spaces maintained by Oeiras, each with its typology, the street and parish it lies in, the park or garden it belongs to, and its area in square metres.",
    topics: ["environment", "cities"],
    numberFields: "area_m2",
  },
  {
    layer: "w_residuos_indiferenciados",
    slug: "oeiras-residuos-indiferenciados",
    title: "Oeiras refuse containers",
    description:
      "Containers for undifferentiated refuse in Oeiras, with the street they stand on, the type of equipment, the capacity in litres and whether collection is collective.",
    topics: ["environment", "cities"],
    numberFields: "capacidade",
  },
  {
    layer: "w_com_serv_estabelecimento_desocupado",
    slug: "oeiras-estabelecimentos-desocupados",
    title: "Oeiras vacant commercial premises",
    description: "Commercial premises recorded as unoccupied in Oeiras, each with its address, whether the record is still active, and the context noted for it.",
    topics: ["economy", "cities"],
    idField: "cod_estabelecimento",
  },
  {
    layer: "w_bicicletas_docas_estacionamento",
    slug: "oeiras-docas-bicicletas",
    title: "Oeiras bicycle parking",
    description:
      "Bicycle parking in Oeiras: the street and reference point, the number of docks and spaces, the type of stand, who is responsible for it, and when it was installed.",
    topics: ["mobility", "cities"],
    dateOnlyFields: "data_instalacao",
  },
  {
    layer: "w_equipamentos_saude",
    slug: "oeiras-equipamentos-saude",
    title: "Oeiras health facilities",
    description: "Health facilities and pharmacies in Oeiras with their address, telephone, email, opening hours, closing days and the body that runs each one.",
    topics: ["health", "cities"],
    idField: "nome",
  },
  {
    layer: "w_colonias_errantes",
    slug: "oeiras-colonias-errantes",
    title: "Oeiras stray cat colonies",
    description: "Registered stray cat colonies in Oeiras, each with the number of cats counted, how many of them are sterilised, and the state the colony has reached.",
    topics: ["environment", "society"],
  },
  {
    layer: "w_orcamento_participativo",
    slug: "oeiras-orcamento-participativo",
    title: "Oeiras participatory budget projects",
    description: "Projects chosen through the participatory budget of Oeiras, each with its description, the edition that chose it, and where it is being carried out.",
    topics: ["government", "cities"],
    idField: "nome",
  },
  {
    layer: "w_hortas_urbanas",
    slug: "oeiras-hortas-urbanas",
    title: "Oeiras urban allotments",
    description: "Urban allotments in Oeiras with their area in square metres, the number of plots each holds, and the facilities supporting them.",
    topics: ["environment", "cities"],
    idField: "nome",
  },
];

/*
 * Torres Vedras publishes nothing itself: its services portal is behind a
 * login it grants by hand, and its geoportal is a viewer whose every layer is
 * proxied from hosts inside the building, with no WMS, WFS or REST of its own.
 * Its plan is public all the same, because the municipality deposited it with
 * the national planning registry, which serves one WFS per concelho keyed by
 * DICO code — 1113 is Torres Vedras. The plan is the municipality's work; DGT
 * is where it is published, and states CC BY on it.
 *
 * The service is GeoMedia, and rejects `application/json` outright: the only
 * GeoJSON it answers to is the older `application/vnd.geo+json`.
 */
const CRUS_TORRES_VEDRAS: ExampleFeed = {
  slug: "torres-vedras-regime-uso-do-solo-feed",
  title: "Torres Vedras land-use regime",
  description:
    "Every parcel of the Carta do Regime de Uso do Solo for Torres Vedras: the class and category of soil each holds under the municipal plan, the designation the plan gives it, its area in hectares, the scale it was drawn at, the source it came from and the date its origin was published. Collected without outlines: asked for the parcels whole the service times out, and these attributes are what can be read and compared.",
  config: {
    source: "wfs",
    feed: "reference",
    host: "servicos.dgterritorio.pt",
    path: "/SDISNITWFSCRUS_1113_1/WFService.aspx",
    typeName: "gmgml:CRUS_Torres_Vedras_V",
    idField: "ID1",
    outputFormat: "application/vnd.geo+json",
    // Asked for the whole type with its outlines, the service spends 200 seconds and then
    // answers 502; asked for these eleven columns it answers all 2,436 parcels in 16, as
    // one document, because it ignores `startIndex` and cannot be asked for less.
    paging: "none",
    propertyNames: "ID1,AREA_HA,Classe_2021,Categoria_2021,Designacao_no_plano,DTCC,Municipio,Autor,Fonte,Escala_origem,Data_Pub_Origem",
    numberFields: "AREA_HA,ID1",
    dateFields: "Data_Pub_Origem",
  },
  publisher: "cm-torres-vedras",
  topics: ["cities", "government"],
  // A municipal plan is revised over years, not weeks.
  staleAfterSeconds: 2_592_000,
  policy: {
    name: "SNIT municipal land-use regime",
    version: 1,
    collection: {
      cadenceSeconds: 604_800,
      timeoutSeconds: 300,
      maxBytes: WFS_MAX_BYTES,
      maxOutputBytes: 48 * 1024 * 1024,
      maxRecordBytes: 256 * 1024,
      maxRecords: 20_000,
      historyMode: "changes",
    },
    serving: { licence: "cc-by", attribution: "Município de Torres Vedras, published through the Sistema Nacional de Informação Territorial (DGT)" },
  },
};

export const WFS_EXAMPLES: ExampleFeed[] = [
  CRUS_TORRES_VEDRAS,
  {
    slug: "effis-portugal-recent-burnt-areas-feed",
    title: "Recent EFFIS burnt areas in Portugal",
    description:
      "Burnt-area polygons attributed to Portugal in the continuously updated EFFIS MODIS database during the past 180 days, with fire dates, latest update, hectares and land-cover shares. Satellite-derived burnt areas are not emergency-service incident perimeters.",
    config: {
      source: "wfs",
      feed: "events",
      host: "maps.effis.emergency.copernicus.eu",
      path: "/effis",
      typeName: "ms:modis.ba.poly",
      idField: "id",
      eventTimeField: "FIREDATE",
      sourcePublishedAtField: "LASTUPDATE",
      countryField: "COUNTRY",
      countryValue: "PT",
      dateField: "FIREDATE",
      numberFields: "AREA_HA,BROADLEA,CONIFER,MIXED,SCLEROPH,TRANSIT,OTHERNATLC,AGRIAREAS,ARTIFSURF,OTHERLC,PERCNA2K",
      dateFields: "FIREDATE,FINALDATE,LASTUPDATE",
      days: "180",
    },
    publisher: "effis-jrc",
    topics: ["environment"],
    staleAfterSeconds: 86_400,
    policy: {
      name: "EFFIS recent burnt-area window",
      version: 1,
      collection: {
        cadenceSeconds: 21_600,
        timeoutSeconds: 180,
        maxBytes: WFS_MAX_BYTES,
        maxOutputBytes: 64 * 1024 * 1024,
        maxRecordBytes: 1024 * 1024,
        maxRecords: 5000,
        historyMode: "changes",
      },
      serving: { licence: "cc-by-4.0", attribution: "European Forest Fire Information System (EFFIS), European Commission Joint Research Centre" },
    },
  },
  ...APPS_DISTRICTS.map(appsExample),
  ...OEIRAS_LAYERS.map(oeirasExample),
];

function oeirasExample(layer: OeirasLayer): ExampleFeed {
  const config: ExampleFeed["config"] = {
    source: "wfs",
    feed: "reference",
    host: OEIRAS_HOST,
    path: OEIRAS_PATH,
    typeName: `dados_abertos:${layer.layer}`,
    idField: layer.idField ?? "@id",
    // The workspace is stored on PT-TM06, so an unqualified read answers in metres:
    // geometry nothing can place and a latitude and longitude that come out empty.
    srsName: "EPSG:4326",
  };
  if (layer.numberFields) config.numberFields = layer.numberFields;
  if (layer.dateFields) config.dateFields = layer.dateFields;
  if (layer.dateOnlyFields) config.dateOnlyFields = layer.dateOnlyFields;
  return {
    slug: `${layer.slug}-feed`,
    title: layer.title,
    description: layer.description,
    config,
    publisher: "cm-oeiras",
    topics: layer.topics,
    staleAfterSeconds: 172_800,
    policy: {
      name: "Oeiras daily reference layer",
      version: 1,
      collection: {
        cadenceSeconds: 86_400,
        timeoutSeconds: 180,
        maxBytes: WFS_MAX_BYTES,
        maxOutputBytes: 48 * 1024 * 1024,
        maxRecordBytes: 256 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
      serving: { licence: "cc-by", attribution: OEIRAS_ATTRIBUTION },
    },
  };
}

function appsExample(district: string): ExampleFeed {
  return {
    slug: `sgifr-apps-${district
      .toLowerCase()
      .normalize("NFD")
      .replaceAll(/[̀-ͯ]/gu, "")}-feed`,
    title: `Fire-prevention priority areas in ${district}`,
    description: `Every Áreas Prioritárias de Prevenção e Segurança (APPS) parcel in the district of ${district}, as approved in the sub-regional action programmes: its municipality, NUTS regions, danger class, type and origin, the plan that approved it, its area in hectares, and whether the burning and land-clearing restrictions of Article 60 and of each paragraph of Article 68 apply to it. Collected without outlines: the national layer's boundaries run to about 250 MB, and these attributes are what can be read and compared.`,
    config: {
      source: "wfs",
      feed: "reference",
      host: "api.sgifr.gov.pt",
      path: "/v1/wfs/AGIF/apps-subregionais",
      typeName: "apps:apps_adaptacao_subregional",
      idField: "id",
      propertyNames:
        "id,comissao,dico,nuts2,nuts3,distrito,municipio,id_apps,perigosidade,nome_apps,tipo_apps,designacao_apps,justificacao,origem_apps,art_60,art_68a,art_68b,art_68c,art_68d,data_aprovacao_publicacao,documento_psa,area_ha,observacoes",
      filterField: "distrito",
      filterValue: district,
      numberFields: "area_ha,id_apps",
      // The approval is a calendar day: the service writes "2024-04-22Z", which is a day wearing a zone, not an instant.
      dateOnlyFields: "data_aprovacao_publicacao",
    },
    publisher: "agif",
    topics: ["environment", "society"],
    // The programmes are revised, not streamed: a week between reads catches a revision the week it lands.
    staleAfterSeconds: 1_209_600,
    policy: {
      name: "SGIFR sub-regional APPS district",
      version: 1,
      collection: {
        cadenceSeconds: 604_800,
        timeoutSeconds: 300,
        maxBytes: WFS_MAX_BYTES,
        maxOutputBytes: 48 * 1024 * 1024,
        maxRecordBytes: 64 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
      serving: { licence: "sgifr-terms", attribution: "AGIF and ANEPC through SGIFR — Sistema de Gestão Integrada de Fogos Rurais (https://www.sgifr.gov.pt)" },
    },
  };
}
