import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { GBFS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/gbfs";
import { GTFS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/gtfs";
import { CARRIS_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/carris";
import { INE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ine";
import { METRO_LISBOA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/metrolisboa";

/** Public transport and shared vehicles: two bespoke operators, two open specifications, and INE's passenger statistics (a feed belongs to the Worker of its first topic). */
export const MOBILITY_EXAMPLES: ExampleFeed[] = [
  ...CARRIS_EXAMPLES,
  ...METRO_LISBOA_EXAMPLES,
  ...GTFS_EXAMPLES,
  ...GBFS_EXAMPLES,
  ...INE_EXAMPLES.filter((example) => example.topics?.[0] === "mobility"),
];
