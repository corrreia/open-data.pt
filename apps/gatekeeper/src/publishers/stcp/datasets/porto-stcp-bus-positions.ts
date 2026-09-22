import type { DatasetDefinition } from "#/catalog/define";
import type { CollectionPolicyDefinition } from "#/index";
import { PORTO_BROKER } from "#/publishers/porto-digital/ngsi";

/**
 * Where the buses are is worth knowing now and worth nothing later, so the
 * positions are replaced rather than kept. That is also what makes a five-minute
 * read affordable: nothing it collects is written to history.
 */
const POSITIONS: CollectionPolicyDefinition = {
  cadenceSeconds: 300,
  timeoutSeconds: 60,
  maxBytes: 4 * 1024 * 1024,
  historyMode: "changes",
  withoutHistory: ["entities"],
};

export const DATASET: DatasetDefinition = {
  title: "STCP bus positions",
  description: "Where each STCP bus in service is now, with its heading, speed, the route it is running and the trip it is on, dated by the clock of the vehicle that reported it.",
  licence: "cc0-1.0",
  attribution: "STCP — Urban Platform",
  topics: ["cities", "mobility"],
  feeds: [
    {
      slug: "porto-stcp-bus-positions-feed",
      config: {
        source: "ngsi",
        feed: "inventory",
        host: PORTO_BROKER,
        entityType: "Vehicle",
        query: "vehicleType==bus",
        timeField: "observationDateTime",
      },
      policy: { name: "NGSI vehicle positions", version: 1, collection: POSITIONS },
      staleAfterSeconds: 3_600,
    },
  ],
};
