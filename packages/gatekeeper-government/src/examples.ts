import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { UDATA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/udata";

/**
 * dados.gov.pt serves several topics: government registers belong here.
 * The Parliament library is wired but its examples are held (research/source-publication-holds.json).
 */
export const GOVERNMENT_EXAMPLES: ExampleFeed[] = UDATA_EXAMPLES.filter((example) => example.topics?.includes("government"));
