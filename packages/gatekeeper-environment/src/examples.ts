import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { ARCGIS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/arcgis";
import { IPMA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ipma";

/** ArcGIS serves two publishers: APA belongs here, Lisboa Aberta to the cities Worker. */
export const ENVIRONMENT_EXAMPLES: ExampleFeed[] = [
  ...IPMA_EXAMPLES,
  ...ARCGIS_EXAMPLES.filter((example) => example.slug.startsWith("apa-")),
];
