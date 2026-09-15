import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { ARCGIS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/arcgis";
import { CKAN_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/ckan";
import { UDATA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/udata";

/** ArcGIS serves two publishers: Lisboa Aberta belongs here, APA to the environment Worker. */
export const CITIES_EXAMPLES: ExampleFeed[] = [
  ...ARCGIS_EXAMPLES.filter((example) => example.slug.startsWith("lisbon-") || example.slug.startsWith("lisboa-")),
  ...CKAN_EXAMPLES,
  ...UDATA_EXAMPLES,
];
