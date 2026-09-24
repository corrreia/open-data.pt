import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-rgn-rede-maregrafica-feed",
  title: "National tide gauge network",
  description:
    "The two tide gauges of the national network, at Cascais and Lagos, with the height of each one's reference mark and the archive its records are published to. The Cascais gauge is the origin of the height datum every orthometric height in Portugal is measured from.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Geodésica Nacional",
  topics: ["environment", "government"],
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/RGN/wfs",
    typeName: "RGN:RedeMaregrafica",
    idField: "@id",
    srsName: "EPSG:4326",
  },
  policy: DGT_MONTHLY_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of RGN:RedeMaregrafica on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
