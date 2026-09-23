import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { OEIRAS_POLICY } from "#/publishers/cm-oeiras/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "oeiras-obras-municipais-feed",
  config: {
    feed: "reference",
    host: "oeirasinterativa.oeiras.pt",
    path: "/gis/services/dados_abertos/wfs",
    typeName: "dados_abertos:w_obras_municipais",
    idField: "@id",
    srsName: "EPSG:4326",
    dateFields: "ultima_atualizacao",
    dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
  },
  policy: OEIRAS_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: every feature of dados_abertos:w_obras_municipais on oeirasinterativa.oeiras.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
