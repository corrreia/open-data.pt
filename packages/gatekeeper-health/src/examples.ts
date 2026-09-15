import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { OPENDATASOFT_EXAMPLES } from "@open-data-pt/gatekeeper-shared/formats/opendatasoft";

/** SNS Transparência publishes through Opendatasoft; E-REDES uses the same library in the energy Worker. */
export const HEALTH_EXAMPLES: ExampleFeed[] = OPENDATASOFT_EXAMPLES.filter((example) => example.slug.startsWith("sns-"));
