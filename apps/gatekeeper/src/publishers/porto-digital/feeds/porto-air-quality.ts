import { defineFeed } from "#/catalog/define";
import { NGSI_DEPLOYMENT, NGSI_NORMALIZER, NGSI_TRANSFORMER, collectNgsiFeed } from "#/formats/ngsi/index";
import { runTransformer } from "#/index";
import { PORTO_BROKER, SENSOR } from "#/publishers/porto-digital/ngsi";

export const FEED = defineFeed(NGSI_DEPLOYMENT, {
  slug: "porto-air-quality-feed",
  title: "Porto air quality",
  description:
    "Carbon monoxide, nitrogen dioxide, ozone and particulate matter measured by the Porto Digital sensor network, each reading dated by the sensor that took it. The network states no units for these measurements, so none are claimed here.",
  licence: "cc0-1.0",
  attribution: "Porto Digital — Urban Platform",
  topics: ["cities", "environment"],
  config: {
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
  /** Every quarter of an hour: every AirQualityObserved entity Porto's broker holds, page by page. */
  fetch: ({ config, validator, library, fetch }) => collectNgsiFeed(config, validator, library.hosts, fetch),
  /** The broker's entities into one series per sensor and measurement, dated by the sensor's clock. */
  transform: { normalizer: NGSI_NORMALIZER, buffered: (bytes, context) => runTransformer(NGSI_TRANSFORMER, bytes, context) },
});
