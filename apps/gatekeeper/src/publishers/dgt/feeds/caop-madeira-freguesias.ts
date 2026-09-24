import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { CAOP_COLUMNS, CAOP_PARISH_COLUMNS, DGT_WEEKLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-caop-madeira-freguesias-feed",
  title: "Madeira parish boundaries (CAOP 2025)",
  description:
    "The 54 civil parishes of the Autonomous Region of Madeira in the official administrative charter: the DTMNFR code, the municipality and island each belongs to, the three NUTS levels, the area in hectares and the perimeter. Attributes only, without boundary outlines.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "society"],
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/caop_ram/wfs",
    typeName: "caop_ram:ram_freguesias",
    idField: "@id",
    srsName: "EPSG:4326",
    numberFields: CAOP_COLUMNS,
    propertyNames: CAOP_PARISH_COLUMNS,
  },
  policy: DGT_WEEKLY_POLICY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: every feature of caop_ram:ram_freguesias on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
