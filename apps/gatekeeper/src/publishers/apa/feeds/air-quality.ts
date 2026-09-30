import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { QUALAR_DEPLOYMENT, QUALAR_NORMALIZER, QUALAR_TRANSFORMER, collectQualarFeed } from "#/publishers/apa/qualar/index";

export const FEED = defineFeed(QUALAR_DEPLOYMENT, {
  slug: "qualar-air-quality-feed",
  title: "Portugal air quality",
  description:
    "The hourly concentration of each pollutant at every station of Portugal's national air quality network, as APA's QualAr shows it: ozone, nitrogen dioxide, sulphur dioxide, PM10, PM2.5 and benzene as hourly means in micrograms per cubic metre, and carbon monoxide as an eight-hour mean in milligrams per cubic metre. Each reading carries its air quality index, from 1 (very good) to 5 (bad). Hours are UTC, each dated by its start. Every hour brings each station's latest hour, and once a day the whole day before is read again, so no hour is missed and a value QualAr has since validated replaces the provisional one. The history starts with our first collection. The stations are run by the regional coordination commissions and published by APA.",
  licence: "source-terms",
  attribution: "QualAr, Agência Portuguesa do Ambiente",
  topics: ["environment", "health"],
  config: { feed: "air-quality" },
  // One small request an hour, and once a day one per station (72, five seconds apart), to a server that also carries SNIRH.
  policy: { cadenceSeconds: 3_600, timeoutSeconds: 900, maxBytes: 4 * 1024 * 1024, historyMode: "changes" },
  staleAfterSeconds: 10_800,
  /** Every hour: each station's latest hour of today; once a day, every station's every hour of yesterday. */
  fetch: ({ config, state, library, fetch, now }) => collectQualarFeed(config, state, library.apiOrigin, fetch, now()),
  /** Each station's hours of each pollutant, into one series per station and pollutant. */
  transform: { normalizer: QUALAR_NORMALIZER, buffered: (bytes, context) => runTransformer(QUALAR_TRANSFORMER, bytes, context) },
});
