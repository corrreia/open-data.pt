import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { QUALAR_DEPLOYMENT, QUALAR_NORMALIZER, QUALAR_TRANSFORMER, collectQualarFeed } from "#/publishers/apa/qualar/index";

export const FEED = defineFeed(QUALAR_DEPLOYMENT, {
  slug: "qualar-air-quality-feed",
  title: "Portugal air quality",
  description:
    "The hourly concentration of each pollutant at every station of Portugal's national air quality network, as APA's QualAr shows it: ozone, nitrogen dioxide, sulphur dioxide, PM10, PM2.5 and benzene as hourly means in micrograms per cubic metre, and carbon monoxide as an eight-hour mean in milligrams per cubic metre. Each reading carries whether it is validated yet and its air quality index, from 1 (very good) to 5 (bad). Hours are UTC, each dated by its start. QualAr shows each station's latest hour; read every hour, the history starts with our first collection. The stations are run by the regional coordination commissions and published by APA.",
  licence: "source-terms",
  attribution: "QualAr, Agência Portuguesa do Ambiente",
  topics: ["environment", "health"],
  config: { feed: "air-quality" },
  // Two small requests an hour to a server that also carries SNIRH.
  policy: { cadenceSeconds: 3_600, timeoutSeconds: 120, maxBytes: 4 * 1024 * 1024, historyMode: "changes" },
  staleAfterSeconds: 10_800,
  /** Every hour: QualAr's latest measurements, for yesterday and today by the UTC calendar. */
  fetch: ({ config, validator, library, fetch, now }) => collectQualarFeed(config, validator, library.apiOrigin, fetch, now()),
  /** Each station's latest hour of each pollutant, into one series per station and pollutant. */
  transform: { normalizer: QUALAR_NORMALIZER, buffered: (bytes, context) => runTransformer(QUALAR_TRANSFORMER, bytes, context) },
});
