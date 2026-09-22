import type { FeedDefinition } from "#/catalog/define";
import { arcgisReferencePolicy } from "#/formats/arcgis/feeds";

/*
 * Mafra means these to be read: a folder named `Dados_Abertos` on the
 * municipality's own server, 52 feature services in it, and an open-data
 * portal at dadosabertos.cm-mafra.pt built on them.
 *
 * Two of the folder's layers are deliberately not read: its copy of the Carris
 * Metropolitana stops is that operator's data, already collected from the
 * operator, and its fuel stations are DGEG's.
 */
const MAFRA_HOST = "geomafra.cm-mafra.pt";
const MAFRA_SERVICE_ROOT = "arcgisext/rest/services/Dados_Abertos";
const MAFRA_POLICY = arcgisReferencePolicy("Mafra daily reference layer");

/** One layer of a service in Mafra's `Dados_Abertos` folder. */
interface MafraLayer {
  slug: string;
  service: string;
  layer: string;
}

export function mafraFeed(layer: MafraLayer): FeedDefinition {
  return {
    slug: layer.slug,
    config: {
      source: "arcgis",
      host: MAFRA_HOST,
      service: `${MAFRA_SERVICE_ROOT}/${layer.service}/FeatureServer`,
      layer: layer.layer,
    },
    policy: MAFRA_POLICY,
    staleAfterSeconds: 172_800,
  };
}
