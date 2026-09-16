import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { OPENDATASOFT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/opendatasoft";
import { DGEG_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/dgeg";
import { EUROSTAT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/eurostat";
import { OMIE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/omie";
import { REN_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ren";

/** Opendatasoft serves two publishers: E-REDES belongs here, SNS to the health Worker. Eurostat publishes on several topics: a feed belongs to the Worker of its first topic. */
export const ENERGY_EXAMPLES: ExampleFeed[] = [
  ...REN_EXAMPLES,
  ...OMIE_EXAMPLES,
  ...DGEG_EXAMPLES,
  ...OPENDATASOFT_EXAMPLES.filter((example) => example.slug.startsWith("e-redes-")),
  ...EUROSTAT_EXAMPLES.filter((example) => example.topics?.[0] === "energy"),
];
