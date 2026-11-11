import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-tyre-collection-points-feed",
  title: "Portugal used tyre collection centres",
  description: "Every centre licensed to receive used tyres in Portugal, mainland and islands: the operator's name, its address and locality.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment"],
  config: {
    host: "inspire.apambiente.pt",
    service: "arcgis/rest/services/INSPIRE/US_PontosRecolhaPneus/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: APA's INSPIRE used-tyre collection layer, its metadata and every feature page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
