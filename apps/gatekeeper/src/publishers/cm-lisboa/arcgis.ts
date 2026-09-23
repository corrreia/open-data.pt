import { arcgisReferencePolicy } from "#/formats/arcgis/feeds";

/*
 * Lisboa Aberta's layers are services under one ArcGIS Online account, at
 * services.arcgis.com/1dSrzEWVQn5kHHyK. Each is a reference layer read once a
 * day, whole; the policy's name says which terms the service resolves to.
 */
export const LISBON_POLICY = arcgisReferencePolicy("ArcGIS daily reference layer");
export const LISBON_UNSTATED_POLICY = arcgisReferencePolicy("ArcGIS daily reference layer, terms unstated");
