import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { INE_EXAMPLES } from "@open-data-pt/gatekeeper-shared/sources/ine";

/**
 * INE publishes on several topics: a feed belongs to the Worker of its first topic.
 * The RIPEstat and PeeringDB libraries are wired but their examples are held until
 * each publisher grants republication (gatekeeper-shared/src/publication-holds.json).
 */
export const TELECOM_EXAMPLES: ExampleFeed[] = INE_EXAMPLES.filter((example) => example.topics?.[0] === "telecom");
