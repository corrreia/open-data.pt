import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-serras-toponimicas-feed",
  title: "Mountain ranges named in use",
  description:
    "The 395 mountain ranges of Portugal that carry a name in common use without being delimited as principal ranges — the toponymic layer of the same study, for names that appear on maps and in speech.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Contributos para a delimitação das serras de Portugal",
  topics: ["culture", "environment"],
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/serras_contributos/wfs",
    typeName: "serras_contributos:Serras_toponimicas",
    idField: "@id",
    srsName: "EPSG:4326",
  },
  policy: DGT_MONTHLY_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of serras_contributos:Serras_toponimicas on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
