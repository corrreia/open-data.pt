import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { BPSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/bpstat";
import { EUROSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/eurostat";
import { INE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ine";

/** INE and Eurostat publish on several topics: a feed belongs to the Worker of its first topic. */
export const ECONOMY_EXAMPLES: ExampleFeed[] = [
  ...BPSTAT_EXAMPLES,
  ...INE_EXAMPLES.filter((example) => example.topics?.[0] === "economy"),
  ...EUROSTAT_EXAMPLES.filter((example) => example.topics?.[0] === "economy"),
];
