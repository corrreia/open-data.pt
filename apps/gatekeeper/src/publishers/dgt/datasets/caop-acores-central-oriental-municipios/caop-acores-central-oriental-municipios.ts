import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { CAOP_MUNICIPALITY_COLUMNS, DGT_WEEKLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-caop-acores-central-oriental-municipios-feed",
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/caop_raa/wfs",
    typeName: "caop_raa:raa_cen_ori_municipios",
    idField: "@id",
    srsName: "EPSG:4326",
    numberFields: "area_ha,perimetro_km,n_freguesias",
    propertyNames: CAOP_MUNICIPALITY_COLUMNS,
  },
  policy: DGT_WEEKLY_POLICY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: every feature of caop_raa:raa_cen_ori_municipios on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
