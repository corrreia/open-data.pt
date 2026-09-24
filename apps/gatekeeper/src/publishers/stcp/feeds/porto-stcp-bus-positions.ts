import { defineFeed } from "#/catalog/define";
import { NGSI_DEPLOYMENT, NGSI_NORMALIZER, NGSI_TRANSFORMER, collectNgsiFeed } from "#/formats/ngsi/index";
import { runTransformer, type CollectionPolicyDefinition } from "#/index";
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

export const FEED = defineFeed(NGSI_DEPLOYMENT, {
  slug: "porto-stcp-bus-positions-feed",
  title: "STCP bus positions",
  description: "Where each STCP bus in service is now, with its heading, speed, the route it is running and the trip it is on, dated by the clock of the vehicle that reported it.",
  licence: "cc0-1.0",
  attribution: "STCP — Urban Platform",
  topics: ["cities", "mobility"],
  config: {
    feed: "inventory",
    host: PORTO_BROKER,
    entityType: "Vehicle",
    query: "vehicleType==bus",
    timeField: "observationDateTime",
  },
  policy: { name: "NGSI vehicle positions", version: 1, collection: POSITIONS },
  staleAfterSeconds: 3_600,
  /** Every five minutes: every bus Vehicle entity on Porto's broker, page by page. */
  fetch: ({ config, validator, library, fetch }) => collectNgsiFeed(config, validator, library.hosts, fetch),
  /** The broker's entities into one current record per bus, dated by the vehicle's own clock. */
  transform: { normalizer: NGSI_NORMALIZER, buffered: (bytes, context) => runTransformer(NGSI_TRANSFORMER, bytes, context) },
});
