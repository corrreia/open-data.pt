import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { GBFS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/gbfs";
import { GTFS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/gtfs";
import { CARRIS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/carris";
import { METRO_LISBOA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/metrolisboa";

/** Public transport and shared vehicles: two bespoke operators and two open specifications. */
export const MOBILITY_EXAMPLES: ExampleFeed[] = [...CARRIS_EXAMPLES, ...METRO_LISBOA_EXAMPLES, ...GTFS_EXAMPLES, ...GBFS_EXAMPLES];
