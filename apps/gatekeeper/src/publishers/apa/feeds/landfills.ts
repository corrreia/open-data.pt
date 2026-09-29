import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-landfills-feed",
  title: "Portugal landfills",
  description:
    "Every landfill APA registers, with its operator, address, economic activity, the regimes it falls under (such as PCIP and PRTR), its landfill type, and a link to its record in APA's licensing system.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/Visualizador/Aterros/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the Aterros MapServer on sniambgeoogc.apambiente.pt — its metadata, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
