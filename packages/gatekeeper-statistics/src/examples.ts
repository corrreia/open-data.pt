import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { OGC_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/ogc";
import { UDATA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { BPSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/bpstat";
import { EUROSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/eurostat";
import { INE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ine";

/** The three statistical offices, each with its own API. */
export const STATISTICS_EXAMPLES: ExampleFeed[] = [
  ...INE_EXAMPLES,
  ...OGC_EXAMPLES.filter((example) => example.slug.startsWith("dgt-")),
  ...BPSTAT_EXAMPLES,
  ...EUROSTAT_EXAMPLES,
  ...UDATA_EXAMPLES.filter((example) => example.topics?.includes("government")),
];
