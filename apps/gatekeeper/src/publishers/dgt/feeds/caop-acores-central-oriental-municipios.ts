import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { CAOP_MUNICIPALITY_COLUMNS, DGT_WEEKLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-caop-acores-central-oriental-municipios-feed",
  title: "Azores central and eastern municipality boundaries (CAOP 2025)",
  description:
    "The 16 municipalities of the central and eastern island groups of the Azores — Terceira, Graciosa, São Jorge, Pico, Faial, São Miguel and Santa Maria — in the official administrative charter: the DTMN code, the island, the three NUTS levels, the area in hectares, the perimeter and the parish count. Attributes only, without boundary outlines.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "society"],
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
