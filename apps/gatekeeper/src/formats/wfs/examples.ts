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
/** One district's parcels, which are that district's own dataset. */
interface AppsDistrict {
  district: string;
  /** The dataset this district's parcels are, a key of `DATASETS`. */
  dataset: string;
}

const APPS_DISTRICTS: AppsDistrict[] = [
  { district: "Aveiro", dataset: "agif-sgifr-apps-aveiro" },
  { district: "Beja", dataset: "agif-sgifr-apps-beja" },
  { district: "Braga", dataset: "agif-sgifr-apps-braga" },
  { district: "Leiria", dataset: "agif-sgifr-apps-leiria" },
  { district: "Lisboa", dataset: "agif-sgifr-apps-lisboa" },
  { district: "Porto", dataset: "agif-sgifr-apps-porto" },
  { district: "Setúbal", dataset: "agif-sgifr-apps-setubal" },
  { district: "Viseu", dataset: "agif-sgifr-apps-viseu" },
];

/*
 * Oeiras publishes a `dados_abertos` workspace of 240 feature types on its own
 * GeoServer. Almost none of those layers carries an identifier column — an
 * inventory of road works names a street, a state and a contractor, and nothing
 * that tells one row from the next — so they are keyed by the identity the
 * service gives each feature, which this GeoServer derives from the key of the
 * table behind the layer and returns in that order.
 */
const OEIRAS_HOST = "oeirasinterativa.oeiras.pt";
const OEIRAS_PATH = "/gis/services/dados_abertos/wfs";

interface OeirasLayer {
  layer: string;
  slug: string;
  /** The dataset this layer is, a key of `DATASETS`. */
  dataset: string;
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
    dataset: "cm-oeiras-condicionalismos-via-publica",
    dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
    dateFields: "ultima_atualizacao",
  },
  {
    layer: "w_obras_municipais",
    slug: "oeiras-obras-municipais",
    dataset: "cm-oeiras-obras-municipais",
    dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
    dateFields: "ultima_atualizacao",
  },
  {
    layer: "w_parquimetros",
    slug: "oeiras-parquimetros",
    dataset: "cm-oeiras-parquimetros",
    dateOnlyFields: "data_levantamento",
  },
  {
    layer: "w_pontos_carregamento",
    slug: "oeiras-pontos-carregamento",
    dataset: "cm-oeiras-pontos-carregamento",
  },
  {
    layer: "w_ciclovias",
    slug: "oeiras-ciclovias",
    dataset: "cm-oeiras-ciclovias",
    // `data_construcao` is written day-first ("21/09/2002"), which is not a date this
    // library parses, so it is kept as the text the service publishes.
    numberFields: "extensao_m",
  },
  {
    layer: "w_espacos_verdes",
    slug: "oeiras-espacos-verdes",
    dataset: "cm-oeiras-espacos-verdes",
    numberFields: "area_m2",
  },
  {
    layer: "w_residuos_indiferenciados",
    slug: "oeiras-residuos-indiferenciados",
    dataset: "cm-oeiras-residuos-indiferenciados",
    numberFields: "capacidade",
  },
  {
    layer: "w_com_serv_estabelecimento_desocupado",
    slug: "oeiras-estabelecimentos-desocupados",
    dataset: "cm-oeiras-estabelecimentos-desocupados",
    idField: "cod_estabelecimento",
  },
  {
    layer: "w_bicicletas_docas_estacionamento",
    slug: "oeiras-docas-bicicletas",
    dataset: "cm-oeiras-docas-bicicletas",
    dateOnlyFields: "data_instalacao",
  },
  {
    layer: "w_equipamentos_saude",
    slug: "oeiras-equipamentos-saude",
    dataset: "cm-oeiras-equipamentos-saude",
    idField: "nome",
  },
  {
    layer: "w_colonias_errantes",
    slug: "oeiras-colonias-errantes",
    dataset: "cm-oeiras-colonias-errantes",
  },
  {
    layer: "w_orcamento_participativo",
    slug: "oeiras-orcamento-participativo",
    dataset: "cm-oeiras-orcamento-participativo",
    idField: "nome",
  },
  {
    layer: "w_hortas_urbanas",
    slug: "oeiras-hortas-urbanas",
    dataset: "cm-oeiras-hortas-urbanas",
    idField: "nome",
  },
];

/*
 * DGT's GeoServer. WFS is switched off for the server as a whole —
 * `/geoserver/ows` answers "Service WFS is disabled" — but on for individual
 * workspaces, so every path here names its workspace.
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
  /** The dataset this layer is, a key of `DATASETS`. */
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
    dataset: "dgt-caop-madeira-municipios",
    cadenceSeconds: 604_800,
    numberFields: `${CAOP_COLUMNS},n_freguesias`,
  },
  {
    workspace: "caop_ram",
    layer: "ram_freguesias",
    propertyNames: CAOP_PARISH_COLUMNS,
    slug: "dgt-caop-madeira-freguesias",
    dataset: "dgt-caop-madeira-freguesias",
    cadenceSeconds: 604_800,
    numberFields: CAOP_COLUMNS,
  },
  {
    workspace: "caop_raa",
    layer: "raa_cen_ori_municipios",
    propertyNames: CAOP_MUNICIPALITY_COLUMNS,
    slug: "dgt-caop-acores-central-oriental-municipios",
    dataset: "dgt-caop-acores-central-oriental-municipios",
    cadenceSeconds: 604_800,
    numberFields: `${CAOP_COLUMNS},n_freguesias`,
  },
  {
    workspace: "caop_raa",
    layer: "raa_cen_ori_freguesias",
    propertyNames: CAOP_PARISH_COLUMNS,
    slug: "dgt-caop-acores-central-oriental-freguesias",
    dataset: "dgt-caop-acores-central-oriental-freguesias",
    cadenceSeconds: 604_800,
    numberFields: CAOP_COLUMNS,
  },
  {
    workspace: "caop_raa",
    layer: "raa_oci_municipios",
    propertyNames: CAOP_MUNICIPALITY_COLUMNS,
    slug: "dgt-caop-acores-ocidental-municipios",
    dataset: "dgt-caop-acores-ocidental-municipios",
    cadenceSeconds: 604_800,
    numberFields: `${CAOP_COLUMNS},n_freguesias`,
  },
  {
    workspace: "caop_raa",
    layer: "raa_oci_freguesias",
    propertyNames: CAOP_PARISH_COLUMNS,
    slug: "dgt-caop-acores-ocidental-freguesias",
    dataset: "dgt-caop-acores-ocidental-freguesias",
    cadenceSeconds: 604_800,
    numberFields: CAOP_COLUMNS,
  },
  {
    workspace: "RGN",
    layer: "VG",
    slug: "dgt-rgn-vertices-geodesicos",
    dataset: "dgt-rgn-vertices-geodesicos",
    // The network is resurveyed over years. Monthly is often enough to notice a
    // vertex being added or retired, and costs the service one read a month.
    cadenceSeconds: 2_592_000,
    numberFields: "M,P",
  },
  {
    workspace: "RGN",
    layer: "RedeNivelamento",
    slug: "dgt-rgn-rede-nivelamento",
    dataset: "dgt-rgn-rede-nivelamento",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "RGN",
    layer: "RedeGravimetrica",
    slug: "dgt-rgn-rede-gravimetrica",
    dataset: "dgt-rgn-rede-gravimetrica",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "RGN",
    layer: "ReNEP",
    slug: "dgt-rgn-renep-estacoes",
    dataset: "dgt-rgn-renep-estacoes",
    cadenceSeconds: 2_592_000,
    numberFields: "LATITUDE,LONGITUDE,ALTITUDE_E",
  },
  {
    workspace: "RGN",
    layer: "RedeMaregrafica",
    slug: "dgt-rgn-rede-maregrafica",
    dataset: "dgt-rgn-rede-maregrafica",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "serras_contributos",
    layer: "Serras_principais",
    // The service also holds a ruggedness rating, in a column whose name carries
    // an accent; a property list is ASCII, so naming the rest leaves that one behind.
    propertyNames: "Serra,_Nome,_OutroNome,Alinhament,Maiores,Alt_max,Alt_media,Altura,Compto_km,Largura_m,Area_km2,Perimet_km,RochaDomin,UnidadeME,GU,Grandeza,VigorAltim",
    slug: "dgt-serras-principais",
    dataset: "dgt-serras-principais",
    // A gazetteer, revised when the study behind it is: monthly is generous.
    cadenceSeconds: 2_592_000,
    numberFields: "Alt_max,Alt_media,Altura,Compto_km,Area_km2,Perimet_km,Largura_m",
  },
  {
    workspace: "serras_contributos",
    layer: "Cumes_principais",
    slug: "dgt-serras-cumes-principais",
    dataset: "dgt-serras-cumes-principais",
    cadenceSeconds: 2_592_000,
    numberFields: "Altitude_m",
  },
  {
    workspace: "serras_contributos",
    layer: "Serras_toponimicas",
    slug: "dgt-serras-toponimicas",
    dataset: "dgt-serras-toponimicas",
    cadenceSeconds: 2_592_000,
  },
  {
    workspace: "fototeca",
    layer: "fototeca",
    slug: "dgt-fototeca-index",
    dataset: "dgt-fototeca-index",
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
    dataset: layer.dataset,
    config,
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
    },
  };
}

export const WFS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "effis-portugal-recent-burnt-areas-feed",
    dataset: "effis-jrc-effis-portugal-recent-burnt-areas",
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
    dataset: layer.dataset,
    config,
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
    },
  };
}

function appsExample({ district, dataset }: AppsDistrict): ExampleFeed {
  return {
    slug: `sgifr-apps-${district
      .toLowerCase()
      .normalize("NFD")
      .replaceAll(/[̀-ͯ]/gu, "")}-feed`,
    dataset,
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
    },
  };
}
