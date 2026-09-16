import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { OGC_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/ogc";
import { UDATA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { INE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ine";

/**
 * INE publishes on several topics: a feed belongs to the Worker of its first topic.
 * OGC serves DGT here and the Azores to the environment Worker; dados.gov.pt serves several topics.
 */
export const SOCIETY_EXAMPLES: ExampleFeed[] = [
  ...INE_EXAMPLES.filter((example) => example.topics?.[0] === "society"),
  ...OGC_EXAMPLES.filter((example) => example.slug.startsWith("dgt-")),
  ...UDATA_EXAMPLES.filter((example) => example.topics?.includes("society")),
];
