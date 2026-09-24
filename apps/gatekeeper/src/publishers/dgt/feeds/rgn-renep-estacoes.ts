import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-rgn-renep-estacoes-feed",
  title: "ReNEP permanent GNSS stations",
  description:
    "The 42 permanent GNSS stations of the Rede Nacional de Estações Permanentes, each with its four-letter code, its position and ellipsoidal height, who owns it, and the archive its RINEX observations are published to. Real-time positioning from these stations needs an account with DGT; the station register itself does not.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Rede Nacional de Estações Permanentes (ReNEP)",
  topics: ["government", "society"],
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/RGN/wfs",
    typeName: "RGN:ReNEP",
    idField: "@id",
    srsName: "EPSG:4326",
    numberFields: "LATITUDE,LONGITUDE,ALTITUDE_E",
  },
  policy: DGT_MONTHLY_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of RGN:ReNEP on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
