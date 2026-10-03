import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { GEO_POSTAL_POLICY, GEO_STALE_AFTER_SECONDS, POSTAL_SERVICE } from "#/publishers/anacom/arcgis";
import { ANACOM_ATTRIBUTION } from "#/publishers/anacom/terms";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "anacom-postal-agencies",
  title: "CTT postal agencies",
  description:
    "Every postal agency (posto de correio) of the universal postal service in Portugal, about 1,900, with its address, parish, opening hours for each day of the week and holidays, and which postal services it offers. ANACOM updates the layer each quarter.",
  licence: "anacom-terms",
  attribution: ANACOM_ATTRIBUTION,
  topics: ["telecom"],
  config: { host: "geo.anacom.pt", service: POSTAL_SERVICE, layer: "9" },
  policy: GEO_POSTAL_POLICY,
  staleAfterSeconds: GEO_STALE_AFTER_SECONDS,
  /** Once a week: layer 9 of GEO.ANACOM's ServicosPostais_Pub MapServer — its metadata, its count, then every feature page by page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per point with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
