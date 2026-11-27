import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { GEO_POINTS_POLICY, GEO_STALE_AFTER_SECONDS, SPECTRUM_PLANNING_SERVICE } from "#/publishers/anacom/arcgis";
import { ANACOM_ATTRIBUTION } from "#/publishers/anacom/terms";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "anacom-amateur-radio-repeaters",
  title: "Amateur radio analogue repeaters",
  description:
    "Every analogue repeater (estação repetidora de modulação analógica) of the amateur service licensed in Portugal, about 140, with the association that holds it, its call sign, frequency band, transmit and receive frequencies, channel and protection tone, its Maidenhead locator, whether it is active, and its district, municipality and parish. The coordinates ANACOM writes in degrees, minutes and seconds are kept as it writes them beside the point's own.",
  licence: "anacom-terms",
  attribution: ANACOM_ATTRIBUTION,
  topics: ["telecom"],
  config: { host: "geo.anacom.pt", service: SPECTRUM_PLANNING_SERVICE, layer: "43" },
  policy: GEO_POINTS_POLICY,
  staleAfterSeconds: GEO_STALE_AFTER_SECONDS,
  /** Once a week: layer 43 of GEO.ANACOM's PlaneamentoGestaoEspectro_Pub MapServer — its metadata, its count, then every feature. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON, streamed, into one record per point with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
