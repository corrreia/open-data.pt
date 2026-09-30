import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-emas-organisations-feed",
  title: "Portugal EMAS-registered organisations",
  description:
    "Every site registered in the EU Eco-Management and Audit Scheme (EMAS) in Portugal: its organisation, registration number and title, activity, and a link to its entry in APA's EMAS register.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment", "economy"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/SNIAmb/Gestao_Ambiental/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the Gestao_Ambiental MapServer on sniambgeoogc.apambiente.pt — its metadata, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
