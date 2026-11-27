import type { FeedPolicy } from "#/catalog/define";
import { ARCGIS_REFERENCE_POLICY } from "#/formats/arcgis/feeds";

/**
 * GEO.ANACOM's postal layers, on geo.anacom.pt's ArcGIS Server, are refreshed once a quarter ("Final 2º Trimestre
 * 2026" in every row) and carry no edit date to compare, so each collection reads the layer whole: once a week is
 * plenty. The mail boxes are the largest, 10,681 points in eleven pages of a thousand, about 6 MB of GeoJSON.
 */
export const GEO_POSTAL_POLICY: FeedPolicy = {
  ...ARCGIS_REFERENCE_POLICY,
  cadenceSeconds: 604_800,
  // Pages queue behind the host's interval (`minIntervalSeconds` in the publisher's index.ts).
  timeoutSeconds: 120,
  maxBytes: 16 * 1024 * 1024,
};

/** Two weeks and a day: one missed collection is not yet stale. */
export const GEO_STALE_AFTER_SECONDS = 2 * 604_800 + 86_400;

/** The MapServer every postal layer is on. */
export const POSTAL_SERVICE = "server/rest/services/publico/ServicosPostais_Pub/MapServer";

/**
 * GEO.ANACOM's small point layers besides the postal ones: the amateur service's shared stations and the probes that
 * measure the digital terrestrial television signal. A few hundred points at most, one page each, with no edit date,
 * so they too are read whole once a week.
 */
export const GEO_POINTS_POLICY: FeedPolicy = {
  ...ARCGIS_REFERENCE_POLICY,
  cadenceSeconds: 604_800,
  timeoutSeconds: 60,
};

/** The MapServer the amateur service's stations are on. */
export const SPECTRUM_PLANNING_SERVICE = "server/rest/services/publico/PlaneamentoGestaoEspectro_Pub/MapServer";

/** The MapServer ANACOM's own measurements are on. */
export const SPECTRUM_MONITORING_SERVICE = "server/rest/services/publico/MonitorizacaoFiscalizacaoEspetro_Pub/MapServer";
