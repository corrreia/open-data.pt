import { defineFeed } from "#/catalog/define";
import { NGSI_DEPLOYMENT, NGSI_NORMALIZER, NGSI_TRANSFORMER, collectNgsiFeed } from "#/formats/ngsi/index";
import { runTransformer } from "#/index";
import { PORTO_BROKER, SENSOR } from "#/publishers/porto-digital/ngsi";

export const FEED = defineFeed(NGSI_DEPLOYMENT, {
  slug: "porto-noise-levels-feed",
  title: "Porto noise levels",
  description: "The equivalent continuous sound level each Porto Digital noise sensor measured, dated by the sensor's own clock.",
  licence: "cc0-1.0",
  attribution: "Porto Digital — Urban Platform",
  topics: ["cities", "environment"],
  config: {
    feed: "observations",
    host: PORTO_BROKER,
    entityType: "NoiseLevelObserved",
    timeField: "dateObserved",
    // LAeq is an A-weighted decibel by definition; the broker states no unit of its own.
    measures: "LAeq=dB(A)",
  },
  policy: { name: "NGSI sensor network", version: 1, collection: SENSOR },
  staleAfterSeconds: 86_400,
  /** Every quarter of an hour: every NoiseLevelObserved entity Porto's broker holds, page by page. */
  fetch: ({ config, validator, library, fetch }) => collectNgsiFeed(config, validator, library.hosts, fetch),
  /** The broker's entities into one sound-level series per sensor, dated by the sensor's clock. */
  transform: { normalizer: NGSI_NORMALIZER, buffered: (bytes, context) => runTransformer(NGSI_TRANSFORMER, bytes, context) },
});
