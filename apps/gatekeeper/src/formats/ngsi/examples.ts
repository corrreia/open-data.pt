import type { CollectionPolicyDefinition, ExampleFeed } from "../../index";

/**
 * Porto runs its Urban Platform on a FIWARE broker that answers without a key,
 * and registers the broker's own query URLs as the resources of datasets on its
 * open-data portal.
 */
const PORTO_BROKER = "broker.fiware.urbanplatform.portodigital.pt";

/**
 * Sensors report every few minutes. Reading every quarter of an hour keeps a
 * useful series without spending a poll on each reading: the points are dated
 * by the sensor's own clock, so a slower read loses resolution, never accuracy.
 */
const SENSOR: CollectionPolicyDefinition = {
  cadenceSeconds: 900,
  timeoutSeconds: 60,
  maxBytes: 2 * 1024 * 1024,
  historyMode: "changes",
};

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

export const NGSI_EXAMPLES: ExampleFeed[] = [
  {
    slug: "porto-air-quality-feed",
    dataset: "porto-digital-urban-sensors",
    title: "Porto air quality",
    description:
      "Carbon monoxide, nitrogen dioxide, ozone and particulate matter measured by the Porto Digital sensor network, each reading dated by the sensor that took it. The network states no units for these measurements, so none are claimed here.",
    config: {
      source: "ngsi",
      feed: "observations",
      host: PORTO_BROKER,
      entityType: "AirQualityObserved",
      timeField: "dateObserved",
      // Every measurement these sensors take, not only the common five: two of the
      // thirteen also report PM1 and one reports temperature, and a measurement left
      // unnamed here would sit in the sensor table as though it described the sensor.
      measures: "co,no2,o3,pm10,pm25,pm1,temperature",
    },
    policy: { name: "NGSI sensor network", version: 1, collection: SENSOR },
    staleAfterSeconds: 86_400,
  },
  {
    slug: "porto-noise-levels-feed",
    dataset: "porto-digital-urban-sensors",
    title: "Porto noise levels",
    description: "The equivalent continuous sound level each Porto Digital noise sensor measured, dated by the sensor's own clock.",
    config: {
      source: "ngsi",
      feed: "observations",
      host: PORTO_BROKER,
      entityType: "NoiseLevelObserved",
      timeField: "dateObserved",
      // LAeq is an A-weighted decibel by definition; the broker states no unit of its own.
      measures: "LAeq=dB(A)",
    },
    policy: { name: "NGSI sensor network", version: 1, collection: SENSOR },
    staleAfterSeconds: 86_400,
  },
  /*
   * The broker's off-street car parks are not read. Nineteen of the twenty
   * carry a capacity and nothing else, and the twentieth reports its free
   * spaces as of August 2020, so there is no occupancy here to publish; what
   * the parks are is already collected from the municipality's own portal.
   */
  {
    slug: "porto-shared-micromobility-spots-feed",
    dataset: "cm-porto-shared-micromobility-spots",
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
  {
    slug: "porto-stcp-bus-positions-feed",
    dataset: "stcp-porto-stcp-bus-positions",
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
];
