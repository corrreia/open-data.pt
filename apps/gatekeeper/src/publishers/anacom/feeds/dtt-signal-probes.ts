import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { GEO_POINTS_POLICY, GEO_STALE_AFTER_SECONDS, SPECTRUM_MONITORING_SERVICE } from "#/publishers/anacom/arcgis";
import { ANACOM_ATTRIBUTION } from "#/publishers/anacom/terms";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "anacom-dtt-signal-probes",
  title: "Digital terrestrial television signal probes",
  description:
    "Every probe of ANACOM's network that measures the digital terrestrial television (TDT) signal across Portugal, about 400, with its name, parish, municipality and district, the quality of the signal it last reported or that it has no results, and the date ANACOM gives for that information.",
  licence: "anacom-terms",
  attribution: ANACOM_ATTRIBUTION,
  topics: ["telecom"],
  config: { host: "geo.anacom.pt", service: SPECTRUM_MONITORING_SERVICE, layer: "72" },
  policy: GEO_POINTS_POLICY,
  staleAfterSeconds: GEO_STALE_AFTER_SECONDS,
  /** Once a week: layer 72 of GEO.ANACOM's MonitorizacaoFiscalizacaoEspetro_Pub MapServer — its metadata, its count, then every feature. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON, streamed, into one record per point with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
