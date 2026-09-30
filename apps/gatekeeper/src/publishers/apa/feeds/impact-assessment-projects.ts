import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-impact-assessment-projects-feed",
  title: "Portugal environmental impact assessment projects",
  description:
    "The projects that went through environmental impact assessment in Portugal, as points: the assessment number and its record in APA's SIAIA system, the project, its typology and class (such as a wind farm), its phase, area and installed power, the authority that assessed it, when the assessment began, and the date and outcome of its decision.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment", "energy"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/AIA/AIA_externo/MapServer",
    layer: "36",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 36 of the AIA_externo MapServer on sniambgeoogc.apambiente.pt — its metadata, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
