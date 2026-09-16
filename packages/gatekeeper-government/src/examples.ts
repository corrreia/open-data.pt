import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { UDATA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { PARLIAMENT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/parliament";

/** Parliament's own open data, and the government registers dados.gov.pt serves (its municipal data belongs to the cities Worker). */
export const GOVERNMENT_EXAMPLES: ExampleFeed[] = [...PARLIAMENT_EXAMPLES, ...UDATA_EXAMPLES.filter((example) => example.topics?.includes("government"))];
