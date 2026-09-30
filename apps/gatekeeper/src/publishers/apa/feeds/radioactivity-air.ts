import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_HOURLY_POLICY } from "#/publishers/apa/arcgis";
import { RADIOACTIVITY_NORMALIZER, RADIOACTIVITY_TRANSFORMER } from "#/publishers/apa/radioactivity";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-radioactivity-air-feed",
  title: "Portugal gamma radiation in air",
  description:
    "The ambient gamma dose rate in air, in nanosieverts per hour, at each station of APA's national radioactivity alert network (RADNET), hourly. Read every hour from APA's SIRAD viewer, which shows each station's latest reading, so the history starts with our first collection. A station under maintenance keeps its last reading until it reports again.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente — RADNET",
  topics: ["environment", "health"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/Visualizador/sirad/MapServer",
    layer: "1",
  },
  policy: APA_HOURLY_POLICY,
  staleAfterSeconds: 10_800,
  /** Every hour: layer 1 of APA's SIRAD viewer, which holds each station's latest reading. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** Each station's reading, into one series per station, dated by when it was measured. */
  transform: { normalizer: RADIOACTIVITY_NORMALIZER, streaming: (body, context) => RADIOACTIVITY_TRANSFORMER.transform(body, context) },
});
