import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { BPSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/bpstat";
import { EUROSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/eurostat";
import { INE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ine";

/** The three statistical offices, each with its own API. */
export const STATISTICS_EXAMPLES: ExampleFeed[] = [
  ...INE_EXAMPLES,
  ...BPSTAT_EXAMPLES,
  ...EUROSTAT_EXAMPLES,
];
