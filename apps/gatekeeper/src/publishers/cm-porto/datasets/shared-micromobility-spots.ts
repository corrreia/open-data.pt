import type { DatasetDefinition } from "#/catalog/define";
import { PORTO_BROKER, SENSOR } from "#/publishers/porto-digital/ngsi";

export const DATASET: DatasetDefinition = {
  title: "Porto shared micromobility parking",
  description:
    "Parking spots for shared scooters and bicycles in Porto: where each is, the spaces it holds and how many of them are free. The broker keeps no clock for these, so each reading is what was true when it was asked.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto — Urban Platform",
  topics: ["cities", "mobility"],
  feeds: [
    {
      slug: "porto-shared-micromobility-spots-feed",
      config: {
        source: "ngsi",
        feed: "inventory",
        host: PORTO_BROKER,
        entityType: "OnStreetParking",
        // The municipality's own dataset selects these the same way. The rest of the type is
        // taxi ranks, which TaxiDigital keeps, and loading bays already read from its portal.
        query: "allowedVehicleType==twoWheeledVehicle",
      },
      policy: { name: "NGSI inventory", version: 1, collection: SENSOR },
      staleAfterSeconds: 86_400,
    },
  ],
};
