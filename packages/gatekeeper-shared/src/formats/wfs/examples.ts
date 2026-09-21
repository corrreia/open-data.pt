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
 * Its plan reaches the public through DGT, which redraws each municipality's
 * Planta de Ordenamento into the national 2021 classification and serves one
 * WFS per concelho keyed by DICO code — 1113 is Torres Vedras.
 *
 * So this is DGT's data about Torres Vedras, not Torres Vedras'. The layer says
 * as much in two columns: `Autor` is DGT and `Fonte` is the municipality's own
 * vectors. DGT curates it, manages it and states CC BY on it.
 *
 * The service is GeoMedia, and rejects `application/json` outright: the only
 * GeoJSON it answers to is the older `application/vnd.geo+json`.
 */
interface CrusClass {
  slug: string;
  /** The class as the plan words it, for the title and the description. */
  name: string;
  /** How the service is asked for it: an equality on a value holding parentheses is refused. */
  pattern: string;
  parcels: number;
}

/*
 * The three classes the plan sorts its land into, which together are the whole
 * layer: 982 urban parcels, 958 urban-but-transitional, 496 rural.
 *
 * It is read a class at a time because the service will not hand over more.
 * Asked for all 2,436 parcels with their outlines it spends 200 seconds and
 * then answers 502; asked for one class it answers in 20 with the outlines
 * intact. It also ignores `startIndex`, so the pages that would otherwise do
 * this job all repeat the first — the class is the only seam it offers.
 */
const CRUS_CLASSES: CrusClass[] = [
  { slug: "solo-urbano", name: "Solo Urbano", pattern: "Solo Urbano", parcels: 982 },
  { slug: "solo-urbanizavel", name: "Solo Urbano (urbanizável – transitório)", pattern: "Solo Urbano (*", parcels: 958 },
  { slug: "solo-rustico", name: "Solo Rústico", pattern: "Solo R*stico", parcels: 496 },
];

function crusTorresVedras(crusClass: CrusClass): ExampleFeed {
  return {
    slug: `torres-vedras-regime-uso-do-solo-${crusClass.slug}-feed`,
    title: `Torres Vedras land-use regime: ${crusClass.name}`,
    description:
      `Every parcel the Carta do Regime de Uso do Solo for Torres Vedras classes as ${crusClass.name} — ${crusClass.parcels} of them — with its outline, ` +
      "the category of soil it holds under the municipal plan, the designation the plan gives it, its area in hectares, the scale it was drawn at, the source it came from and the date its origin was published.",
    config: {
      source: "wfs",
      feed: "reference",
      host: "servicos.dgterritorio.pt",
      path: "/SDISNITWFSCRUS_1113_1/WFService.aspx",
      typeName: "gmgml:CRUS_Torres_Vedras_V",
      idField: "ID1",
      outputFormat: "application/vnd.geo+json",
      // Stored on PT-TM06: unasked, the service answers in metres, which is an outline
      // nothing can place and a latitude and longitude that come out empty.
      srsName: "EPSG:4326",
      paging: "none",
      filterField: "Classe_2021",
      filterPattern: crusClass.pattern,
      numberFields: "AREA_HA,ID1",
      dateFields: "Data_Pub_Origem",
    },
    publisher: "dgt",
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
        // One parcel is one outline, and a rural parcel can be an elaborate one.
        maxRecordBytes: 1024 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
      serving: { licence: "cc-by", attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial, from the municipal plan of Torres Vedras" },
    },
  };
}

/*
 * DGT's GeoServer. Its capabilities state `Fees none` and `AccessConstraints
 * none`, and DGT's dados.gov.pt records carry CC BY, as the rest of its
 * services do. WFS is switched off for the server as a whole — `/geoserver/ows`
 * answers "Service WFS is disabled" — but on for individual workspaces, so
 * every path here names its workspace.
 *
 * This is where the islands are. The pygeoapi service the `ogc` library reads
 * carries the mainland alone, and the CAOP feeds there say so; Madeira and the
 * Azores are published only here, in the same columns as the mainland.
 *
 * Two workspaces are deliberately not read. `altimetria` holds 60,084 spot
 * heights and 56,329 contour lines, past the 40,000 features a reference feed
 * may buffer, and the service pages them at about fourteen seconds per five
 * hundred. `CLC` holds 53,776 CORINE polygons, past the same bound.
 */
const GEO2_HOST = "geo2.dgterritorio.gov.pt";

interface Geo2Layer {
  workspace: string;
  layer: string;
  slug: string;
  title: string;
  description: string;
  topics: NonNullable<ExampleFeed["topics"]>;
  /** What DGT is credited as for this layer. */
  dataset: string;
  /** How often the layer is read, in seconds; an edition-based layer weekly, an archive monthly. */
  cadenceSeconds: number;
  /** Raised past the five minutes a small layer needs, where the walk is long. */
  timeoutSeconds?: number;
  numberFields?: string;
  /**
   * The attributes to ask for, where the outlines must be left at the source.
   * Naming any column at all is how the geometry column is left out.
   */
  propertyNames?: string;
  /** Raised past the default only for a layer with tens of thousands of features. */
  maxRecords?: number;
}

const CAOP_2025 = "Carta Administrativa Oficial de Portugal (CAOP) 2025";
const CAOP_COLUMNS = "area_ha,perimetro_km";
/*
 * The island charter is read as attributes, exactly as the mainland one is, and
 * for the same reason: Porto Santo alone carries 1.3 MB of coastline and islets,
 * past the megabyte the kernel stores a record in, and one Azorean municipality
 * reaches half of it. Naming the columns is what leaves the geometry behind.
 */
const CAOP_MUNICIPALITY_COLUMNS = "dtmn,municipio,distrito_ilha,nuts1,nuts2,nuts3,nuts3_cod,area_ha,perimetro_km,n_freguesias";
const CAOP_PARISH_COLUMNS = "dtmnfr,freguesia,municipio,distrito_ilha,nuts1,nuts2,nuts3,nuts3_cod,area_ha,perimetro_km";

const GEO2_LAYERS: Geo2Layer[] = [
  {
    workspace: "caop_ram",
    layer: "ram_municipios",
    propertyNames: CAOP_MUNICIPALITY_COLUMNS,
    slug: "dgt-caop-madeira-municipios",
    title: "Madeira municipality boundaries (CAOP 2025)",
    description:
      "The 11 municipalities of the Autonomous Region of Madeira in the official administrative charter: the DTMN code, the island each belongs to, the three NUTS levels, the area in hectares, the perimeter and how many parishes each holds. Attributes only, without boundary outlines.",
    topics: ["society", "cities"],
    dataset: CAOP_2025,
    cadenceSeconds: 604_800,
    numberFields: `${CAOP_COLUMNS},n_freguesias`,
  },
  {
    workspace: "caop_ram",
    layer: "ram_freguesias",
    propertyNames: CAOP_PARISH_COLUMNS,
    slug: "dgt-caop-madeira-freguesias",
    title: "Madeira parish boundaries (CAOP 2025)",
    description:
      "The 54 civil parishes of the Autonomous Region of Madeira in the official administrative charter: the DTMNFR code, the municipality and island each belongs to, the three NUTS levels, the area in hectares and the perimeter. Attributes only, without boundary outlines.",
    topics: ["society", "cities"],
    dataset: CAOP_2025,
    cadenceSeconds: 604_800,
    numberFields: CAOP_COLUMNS,
  },
  {
    workspace: "caop_raa",
    layer: "raa_cen_ori_municipios",
    propertyNames: CAOP_MUNICIPALITY_COLUMNS,
    slug: "dgt-caop-acores-central-oriental-municipios",
    title: "Azores central and eastern municipality boundaries (CAOP 2025)",
    description:
      "The 16 municipalities of the central and eastern island groups of the Azores — Terceira, Graciosa, São Jorge, Pico, Faial, São Miguel and Santa Maria — in the official administrative charter: the DTMN code, the island, the three NUTS levels, the area in hectares, the perimeter and the parish count. Attributes only, without boundary outlines.",
    topics: ["society", "cities"],
    dataset: CAOP_2025,
    cadenceSeconds: 604_800,
    numberFields: `${CAOP_COLUMNS},n_freguesias`,
  },
  {
    workspace: "caop_raa",
    layer: "raa_cen_ori_freguesias",
    propertyNames: CAOP_PARISH_COLUMNS,
    slug: "dgt-caop-acores-central-oriental-freguesias",
    title: "Azores central and eastern parish boundaries (CAOP 2025)",
    description:
      "The 144 civil parishes of the central and eastern island groups of the Azores in the official administrative charter: the DTMNFR code, the municipality and island each belongs to, the three NUTS levels, the area in hectares and the perimeter. Attributes only, without boundary outlines.",
    topics: ["society", "cities"],
    dataset: CAOP_2025,
    cadenceSeconds: 604_800,
    numberFields: CAOP_COLUMNS,
  },
  {
    workspace: "caop_raa",
    layer: "raa_oci_municipios",
    propertyNames: CAOP_MUNICIPALITY_COLUMNS,
    slug: "dgt-caop-acores-ocidental-municipios",
    title: "Azores western municipality boundaries (CAOP 2025)",
    description:
      "The 3 municipalities of the western island group of the Azores — Flores and Corvo — in the official administrative charter: the DTMN code, the island, the three NUTS levels, the area in hectares, the perimeter and the parish count. Attributes only, without boundary outlines.",
    topics: ["society", "cities"],
    dataset: CAOP_2025,
    cadenceSeconds: 604_800,
    numberFields: `${CAOP_COLUMNS},n_freguesias`,
  },
  {
    workspace: "caop_raa",
    layer: "raa_oci_freguesias",
    propertyNames: CAOP_PARISH_COLUMNS,
    slug: "dgt-caop-acores-ocidental-freguesias",
    title: "Azores western parish boundaries (CAOP 2025)",
    description:
      "The 12 civil parishes of Flores and Corvo, the western island group of the Azores, in the official administrative charter: the DTMNFR code, the municipality and island each belongs to, the three NUTS levels, the area in hectares and the perimeter. Attributes only, without boundary outlines.",
    topics: ["society", "cities"],
    dataset: CAOP_2025,
    cadenceSeconds: 604_800,
    numberFields: CAOP_COLUMNS,
  },
  {
    workspace: "RGN",
    layer: "VG",
    slug: "dgt-rgn-vertices-geodesicos",
    title: "National geodetic network vertices",
    description:
      "The 7,968 vertices of the Rede Geodésica Nacional, where each one stands and what it is worth as a control point: the name it is known by, the 1:50,000 sheet it falls on, the order of the network it belongs to, its topographic height, its PT-TM06 coordinates and whether those were observed or transformed. This is the survey register; the same marks appear in the easement register with the municipality each stands in and nothing about their height.",
    topics: ["government", "society"],
    dataset: "Rede Geodésica Nacional",
    // The network is resurveyed over years. Monthly is often enough to notice a
    // vertex being added or retired, and costs the service one read a month.
    cadenceSeconds: 2_592_000,
    numberFields: "M,P",
  },
  {
    workspace: "RGN",
    layer: "RedeNivelamento",
    slug: "dgt-rgn-rede-nivelamento",
    title: "National levelling network marks",
    description:
      "The 4,735 benchmarks of the national levelling network, each with its orthometric height above the Cascais datum, the levelling lines and sections it belongs to, and a written description of exactly where it is set — the doorstep of a citadel, the footing of a column.",
    topics: ["government", "society"],
    dataset: "Rede Geodésica Nacional",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "RGN",
    layer: "RedeGravimetrica",
    slug: "dgt-rgn-rede-gravimetrica",
    title: "National gravimetric network stations",
    description: "The 6,584 stations of the national gravimetric network, where each one stands and the measurements recorded for it.",
    topics: ["government", "society"],
    dataset: "Rede Geodésica Nacional",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "RGN",
    layer: "ReNEP",
    slug: "dgt-rgn-renep-estacoes",
    title: "ReNEP permanent GNSS stations",
    description:
      "The 42 permanent GNSS stations of the Rede Nacional de Estações Permanentes, each with its four-letter code, its position and ellipsoidal height, who owns it, and the archive its RINEX observations are published to. Real-time positioning from these stations needs an account with DGT; the station register itself does not.",
    topics: ["government", "society"],
    dataset: "Rede Nacional de Estações Permanentes (ReNEP)",
    cadenceSeconds: 2_592_000,
    numberFields: "LATITUDE,LONGITUDE,ALTITUDE_E",
  },
  {
    workspace: "RGN",
    layer: "RedeMaregrafica",
    slug: "dgt-rgn-rede-maregrafica",
    title: "National tide gauge network",
    description:
      "The two tide gauges of the national network, at Cascais and Lagos, with the height of each one's reference mark and the archive its records are published to. The Cascais gauge is the origin of the height datum every orthometric height in Portugal is measured from.",
    topics: ["environment", "government"],
    dataset: "Rede Geodésica Nacional",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "serras_contributos",
    layer: "Serras_principais",
    // The service also holds a ruggedness rating, in a column whose name carries
    // an accent; a property list is ASCII, so naming the rest leaves that one behind.
    propertyNames: "Serra,_Nome,_OutroNome,Alinhament,Maiores,Alt_max,Alt_media,Altura,Compto_km,Largura_m,Area_km2,Perimet_km,RochaDomin,UnidadeME,GU,Grandeza,VigorAltim",
    slug: "dgt-serras-principais",
    title: "Portugal's principal mountain ranges",
    description:
      "The 588 principal mountain ranges of Portugal as DGT delimits them, each with the name it goes by, its alignment, its highest and mean altitude, its height above the land around it, its length, width, area and perimeter, the rock that dominates it, the morphostructural and geomorphological units it belongs to, and how it rates for size and altimetric vigour. Attributes only: the 588 outlines come to eleven megabytes, more than one read of this service may carry.",
    topics: ["environment", "culture"],
    dataset: "Contributos para a delimitação das serras de Portugal",
    // A gazetteer, revised when the study behind it is: monthly is generous.
    cadenceSeconds: 2_592_000,
    numberFields: "Alt_max,Alt_media,Altura,Compto_km,Area_km2,Perimet_km,Largura_m",
  },
  {
    workspace: "serras_contributos",
    layer: "Cumes_principais",
    slug: "dgt-serras-cumes-principais",
    title: "Principal mountain summits",
    description: "The 587 principal summits of the Portuguese mountain ranges, each with the range it crowns and its altitude in metres.",
    topics: ["environment", "culture"],
    dataset: "Contributos para a delimitação das serras de Portugal",
    cadenceSeconds: 2_592_000,
    numberFields: "Altitude_m",
  },
  {
    workspace: "serras_contributos",
    layer: "Serras_toponimicas",
    slug: "dgt-serras-toponimicas",
    title: "Mountain ranges named in use",
    description:
      "The 395 mountain ranges of Portugal that carry a name in common use without being delimited as principal ranges — the toponymic layer of the same study, for names that appear on maps and in speech.",
    topics: ["culture", "environment"],
    dataset: "Contributos para a delimitação das serras de Portugal",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "fototeca",
    layer: "fototeca",
    slug: "dgt-fototeca-index",
    title: "Aerial photograph archive index",
    description:
      "Where each of the 29,979 aerial photographs in DGT's Fototeca was taken and when — the earliest here date from 1945 — with the 1:50,000 sheet, the roll, the strip and the frame number that identify the print in the archive. An index of the collection, not the photographs themselves.",
    topics: ["culture", "society"],
    dataset: "Fototeca",
    // A historical archive: it grows when a collection is catalogued, not weekly.
    cadenceSeconds: 2_592_000,
    // Thirty pages at about six seconds each, on the largest layer read here.
    timeoutSeconds: 600,
    maxRecords: 40_000,
  },
];

/**
 * One layer of DGT's GeoServer. A layer carries its geometry unless a property
 * list says otherwise: the geodetic networks, the summits and the photograph
 * index are points and cost almost nothing, while the administrative charter
 * and the mountain outlines are read as attributes and left where they are.
 */
function geo2Example(layer: Geo2Layer): ExampleFeed {
  const config: ExampleFeed["config"] = {
    source: "wfs",
    feed: "reference",
    host: GEO2_HOST,
    path: `/geoserver/${layer.workspace}/wfs`,
    typeName: `${layer.workspace}:${layer.layer}`,
    // None of these layers carries a column that tells one row from the next, so
    // each is keyed by the identity the service gives its features.
    idField: "@id",
    // Stored on PT-TM06: unasked, the service answers in metres, which is an
    // outline nothing can place and a latitude and longitude that come out empty.
    srsName: "EPSG:4326",
  };
  if (layer.numberFields) config.numberFields = layer.numberFields;
  if (layer.propertyNames) config.propertyNames = layer.propertyNames;
  return {
    slug: `${layer.slug}-feed`,
    title: layer.title,
    description: layer.description,
    config,
    publisher: "dgt",
    topics: layer.topics,
    // Two reads' grace: a layer republished just after a run is not called stale
    // before the next run has had its chance at it.
    staleAfterSeconds: layer.cadenceSeconds * 2,
    policy: {
      name: "DGT GeoServer reference layer",
      version: 1,
      collection: {
        cadenceSeconds: layer.cadenceSeconds,
        timeoutSeconds: layer.timeoutSeconds ?? 300,
        maxBytes: WFS_MAX_BYTES,
        maxOutputBytes: 48 * 1024 * 1024,
        maxRecordBytes: 512 * 1024,
        maxRecords: layer.maxRecords ?? 20_000,
        historyMode: "changes",
      },
      serving: { licence: "cc-by", attribution: `Direção-Geral do Território — ${layer.dataset}` },
    },
  };
}

export const WFS_EXAMPLES: ExampleFeed[] = [
  ...CRUS_CLASSES.map(crusTorresVedras),
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
  ...GEO2_LAYERS.map(geo2Example),
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
