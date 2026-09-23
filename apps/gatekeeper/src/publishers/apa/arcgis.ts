import { arcgisReferencePolicy } from "#/formats/arcgis/feeds";

/** APA's SNIAmb map services, at sniambgeoogc.apambiente.pt: each a reference layer read once a day, whole. */
export const APA_POLICY = arcgisReferencePolicy("APA daily reference layer");
