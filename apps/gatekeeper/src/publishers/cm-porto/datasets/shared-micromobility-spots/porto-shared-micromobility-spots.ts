import { defineFeed } from "#/catalog/define";
import { NGSI_DEPLOYMENT, NGSI_NORMALIZER, NGSI_TRANSFORMER, collectNgsiFeed } from "#/formats/ngsi/index";
import { runTransformer } from "#/index";
import { PORTO_BROKER, SENSOR } from "#/publishers/porto-digital/ngsi";

export const FEED = defineFeed(NGSI_DEPLOYMENT, {
  slug: "porto-shared-micromobility-spots-feed",
  config: {
    feed: "inventory",
    host: PORTO_BROKER,
    entityType: "OnStreetParking",
    // The municipality's own dataset selects these the same way. The rest of the type is
    // taxi ranks, which TaxiDigital keeps, and loading bays already read from its portal.
    query: "allowedVehicleType==twoWheeledVehicle",
  },
  policy: { name: "NGSI inventory", version: 1, collection: SENSOR },
  staleAfterSeconds: 86_400,
  /** Every quarter of an hour: the OnStreetParking entities on Porto's broker that allow two-wheeled vehicles, page by page. */
  fetch: ({ config, validator, library, fetch }) => collectNgsiFeed(config, validator, library.hosts, fetch),
  /** The broker's entities into one current record per parking spot, with its free spaces as asked. */
  transform: { normalizer: NGSI_NORMALIZER, buffered: (bytes, context) => runTransformer(NGSI_TRANSFORMER, bytes, context) },
});
