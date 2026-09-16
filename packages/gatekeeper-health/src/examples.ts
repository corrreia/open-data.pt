import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { OPENDATASOFT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/opendatasoft";
import { UDATA_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/udata";

/** SNS Transparência publishes through Opendatasoft (E-REDES uses the same library in the energy Worker); DGS through dados.gov.pt. */
export const HEALTH_EXAMPLES: ExampleFeed[] = [
  ...OPENDATASOFT_EXAMPLES.filter((example) => example.slug.startsWith("sns-")),
  ...UDATA_EXAMPLES.filter((example) => example.topics?.includes("health")),
];
