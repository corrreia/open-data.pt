import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-drinking-water-protection-areas-feed",
  title: "Portugal drinking-water protection areas",
  description:
    "The zones designated to protect water abstracted for human consumption, under the Water Framework Directive: each one's name, water category, the water body it belongs to and its river basin district.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment"],
  config: {
    host: "inspire.apambiente.pt",
    service: "arcgis/rest/services/INSPIRE/AM_DrinkingWaterProtectionArea/MapServer",
    layer: "0",
    // The server fails to write seven of these areas as GeoJSON (November 2026).
    format: "json",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: APA's INSPIRE drinking-water protection layer, its metadata and every feature page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
