import type { FeedDefinition } from "../../catalog/define";
import { WFS_MAX_BYTES } from "../../formats/wfs";

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
  slug: string;
  /** The district's name as the service writes it in `distrito`. */
  district: string;
}

export function appsFeed({ slug, district }: AppsDistrict): FeedDefinition {
  return {
    slug,
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
