import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { APPS_POLICY, APPS_PROPERTY_NAMES } from "#/publishers/agif/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "sgifr-apps-viseu-feed",
  title: "Fire-prevention priority areas in Viseu",
  description:
    "Every Áreas Prioritárias de Prevenção e Segurança (APPS) parcel in the district of Viseu, as approved in the sub-regional action programmes: its municipality, NUTS regions, danger class, type and origin, the plan that approved it, its area in hectares, and whether the burning and land-clearing restrictions of Article 60 and of each paragraph of Article 68 apply to it. Collected without outlines: the national layer's boundaries run to about 250 MB, and these attributes are what can be read and compared.",
  licence: "sgifr-terms",
  attribution: "AGIF and ANEPC through SGIFR — Sistema de Gestão Integrada de Fogos Rurais (https://www.sgifr.gov.pt)",
  topics: ["environment", "society"],
  config: {
    feed: "reference",
    host: "api.sgifr.gov.pt",
    path: "/v1/wfs/AGIF/apps-subregionais",
    typeName: "apps:apps_adaptacao_subregional",
    idField: "id",
    propertyNames: APPS_PROPERTY_NAMES,
    filterField: "distrito",
    filterValue: "Viseu",
    numberFields: "area_ha,id_apps",
    // The approval is a calendar day: the service writes "2024-04-22Z", which is a day wearing a zone, not an instant.
    dateOnlyFields: "data_aprovacao_publicacao",
  },
  policy: APPS_POLICY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: every feature of apps:apps_adaptacao_subregional whose distrito is Viseu, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
