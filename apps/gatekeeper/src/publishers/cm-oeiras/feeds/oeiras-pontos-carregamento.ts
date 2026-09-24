import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { OEIRAS_POLICY } from "#/publishers/cm-oeiras/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "oeiras-pontos-carregamento-feed",
  title: "Oeiras electric-vehicle charging points",
  description: "Charging points in Oeiras with their MOBI.E identifier, operator, charging power, voltage level, connector format and sockets.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["energy", "mobility"],
  config: {
    feed: "reference",
    host: "oeirasinterativa.oeiras.pt",
    path: "/gis/services/dados_abertos/wfs",
    typeName: "dados_abertos:w_pontos_carregamento",
    idField: "@id",
    srsName: "EPSG:4326",
  },
  policy: OEIRAS_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: every feature of dados_abertos:w_pontos_carregamento on oeirasinterativa.oeiras.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
