import { ARCGIS_REFERENCE_POLICY } from "#/formats/arcgis/feeds";

/** APA's SNIAmb map services, at sniambgeoogc.apambiente.pt: each a reference layer read once a day, whole. */
export const APA_POLICY = ARCGIS_REFERENCE_POLICY;

/** A layer whose rows are live readings or live states: read every hour, keeping each change. */
export const APA_HOURLY_POLICY = { ...ARCGIS_REFERENCE_POLICY, cadenceSeconds: 3_600 } as const;
