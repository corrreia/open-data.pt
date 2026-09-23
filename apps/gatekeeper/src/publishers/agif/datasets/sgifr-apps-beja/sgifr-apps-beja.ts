import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { APPS_POLICY, APPS_PROPERTY_NAMES } from "#/publishers/agif/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "sgifr-apps-beja-feed",
  config: {
    feed: "reference",
    host: "api.sgifr.gov.pt",
    path: "/v1/wfs/AGIF/apps-subregionais",
    typeName: "apps:apps_adaptacao_subregional",
    idField: "id",
    propertyNames: APPS_PROPERTY_NAMES,
    filterField: "distrito",
    filterValue: "Beja",
    numberFields: "area_ha,id_apps",
    // The approval is a calendar day: the service writes "2024-04-22Z", which is a day wearing a zone, not an instant.
    dateOnlyFields: "data_aprovacao_publicacao",
  },
  policy: APPS_POLICY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: every feature of apps:apps_adaptacao_subregional whose distrito is Beja, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
