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

export const WFS_EXAMPLES: ExampleFeed[] = [
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
];

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
      dateFields: "data_aprovacao_publicacao",
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
