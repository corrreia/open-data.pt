import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

/*
 * A historical archive: it grows when a collection is catalogued, not weekly.
 * Thirty pages at about six seconds each, on the largest layer read here.
 */
const FOTOTECA_POLICY = {
  ...DGT_MONTHLY_POLICY,
  collection: { ...DGT_MONTHLY_POLICY.collection, timeoutSeconds: 600, maxRecords: 40_000 },
};

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-fototeca-index-feed",
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/fototeca/wfs",
    typeName: "fototeca:fototeca",
    idField: "@id",
    srsName: "EPSG:4326",
  },
  policy: FOTOTECA_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of fototeca:fototeca on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
