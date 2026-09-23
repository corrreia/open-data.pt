import type { FeedPolicy } from "#/catalog/define";
import { WFS_MAX_BYTES } from "#/formats/wfs/index";

/*
 * The APPS layer is national — 22,631 parcels, about 22 MB of attributes — but
 * a Gatekeeper buffers a reference layer whole, under a 16 MB cap that no feed
 * policy may raise. So it is read one district at a time: every parcel and
 * every attribute is still published, and the largest district, Aveiro, is
 * about 11 MB. These eight are the districts the approved sub-regional
 * programmes cover; the other ten answer with no parcels at all.
 */

/** The attributes every district's feed asks for: all of them, without the outlines. */
export const APPS_PROPERTY_NAMES =
  "id,comissao,dico,nuts2,nuts3,distrito,municipio,id_apps,perigosidade,nome_apps,tipo_apps,designacao_apps,justificacao,origem_apps,art_60,art_68a,art_68b,art_68c,art_68d,data_aprovacao_publicacao,documento_psa,area_ha,observacoes";

/** The programmes are revised, not streamed: a week between reads catches a revision the week it lands. */
export const APPS_POLICY: FeedPolicy = {
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
};
