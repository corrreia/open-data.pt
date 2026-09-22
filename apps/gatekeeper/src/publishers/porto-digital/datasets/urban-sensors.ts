import type { DatasetDefinition } from "../../../catalog/define";
import { PORTO_BROKER, SENSOR } from "../ngsi";

export const DATASET: DatasetDefinition = {
  title: "Porto urban sensors",
  description: "What Porto Digital's street sensors measure: air quality and noise.",
  licence: "cc0-1.0",
  attribution: "Porto Digital — Urban Platform",
  topics: ["cities", "environment"],
  feeds: [
    {
      slug: "porto-air-quality-feed",
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
  ],
};
