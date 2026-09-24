import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-rgn-vertices-geodesicos-feed",
  title: "National geodetic network vertices",
  description:
    "The 7,968 vertices of the Rede Geodésica Nacional, where each one stands and what it is worth as a control point: the name it is known by, the 1:50,000 sheet it falls on, the order of the network it belongs to, its topographic height, its PT-TM06 coordinates and whether those were observed or transformed. This is the survey register; the same marks appear in the easement register with the municipality each stands in and nothing about their height.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Geodésica Nacional",
  topics: ["government", "society"],
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/RGN/wfs",
    typeName: "RGN:VG",
    idField: "@id",
    srsName: "EPSG:4326",
    numberFields: "M,P",
  },
  // The network is resurveyed over years. Monthly is often enough to notice a
  // vertex being added or retired, and costs the service one read a month.
  policy: DGT_MONTHLY_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of RGN:VG on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
