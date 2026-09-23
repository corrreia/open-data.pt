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
export const MAFRA_POLICY = arcgisReferencePolicy("Mafra daily reference layer");
