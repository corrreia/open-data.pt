import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-serras-cumes-principais-feed",
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/serras_contributos/wfs",
    typeName: "serras_contributos:Cumes_principais",
    idField: "@id",
    srsName: "EPSG:4326",
    numberFields: "Altitude_m",
  },
  policy: DGT_MONTHLY_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of serras_contributos:Cumes_principais on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
