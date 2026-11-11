import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-river-water-bodies-feed",
  title: "Portugal river water bodies",
  description:
    "The 1,621 stretches of river mainland Portugal reports under the Water Framework Directive, each with the line it follows: its name and code, its river basin district, whether it is natural or heavily modified, its type, whether it crosses the border, and its ecological, chemical and overall status with the year each objective is due.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment"],
  config: {
    host: "inspire.apambiente.pt",
    service: "arcgis/rest/services/INSPIRE/AM_WaterBodyForWFD_WFDRiver/MapServer",
    layer: "0",
  },
  // Every river's line, whole, is 18 MB of GeoJSON (November 2026).
  policy: { ...APA_POLICY, timeoutSeconds: 120, maxBytes: 48 * 1024 * 1024, maxOutputBytes: 64 * 1024 * 1024, maxRecordBytes: 1024 * 1024 },
  staleAfterSeconds: 172_800,
  /** Once a day: APA's INSPIRE river water-body layer, its metadata and every feature page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
