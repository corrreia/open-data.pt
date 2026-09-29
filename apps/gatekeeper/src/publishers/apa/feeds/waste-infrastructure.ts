import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-waste-infrastructure-feed",
  title: "Portugal municipal waste infrastructure",
  description:
    "The infrastructure that treats Portugal's municipal waste (landfills, mechanical and biological treatment, sorting, refuse-derived fuel): each site's name and main activity.",
  licence: "source-terms",
  attribution: "Agência Portuguesa do Ambiente",
  topics: ["environment", "cities"],
  config: {
    host: "sniambgeoogc.apambiente.pt",
    service: "getogc/rest/services/SNIAmb/Residuos_306/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: layer 0 of the Residuos_306 MapServer on sniambgeoogc.apambiente.pt — its metadata, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
