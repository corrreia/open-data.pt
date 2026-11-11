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
    host: "inspire.apambiente.pt",
    service: "arcgis/rest/services/INSPIRE/US_Residuos_MRRU/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: APA's INSPIRE urban-waste infrastructure layer, its metadata and every feature page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
