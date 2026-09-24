import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_MAX_BYTES, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "effis-portugal-recent-burnt-areas-feed",
  title: "Recent EFFIS burnt areas in Portugal",
  description:
    "Burnt-area polygons attributed to Portugal in the continuously updated EFFIS MODIS database during the past 180 days, with fire dates, latest update, hectares and land-cover shares. Satellite-derived burnt areas are not emergency-service incident perimeters.",
  licence: "cc-by-4.0",
  attribution: "European Forest Fire Information System (EFFIS), European Commission Joint Research Centre",
  topics: ["environment"],
  config: {
    feed: "events",
    host: "maps.effis.emergency.copernicus.eu",
    path: "/effis",
    typeName: "ms:modis.ba.poly",
    idField: "id",
    eventTimeField: "FIREDATE",
    sourcePublishedAtField: "LASTUPDATE",
    countryField: "COUNTRY",
    countryValue: "PT",
    dateField: "FIREDATE",
    numberFields: "AREA_HA,BROADLEA,CONIFER,MIXED,SCLEROPH,TRANSIT,OTHERNATLC,AGRIAREAS,ARTIFSURF,OTHERLC,PERCNA2K",
    dateFields: "FIREDATE,FINALDATE,LASTUPDATE",
    days: "180",
  },
  policy: {
    name: "EFFIS recent burnt-area window",
    version: 1,
    collection: {
      cadenceSeconds: 21_600,
      timeoutSeconds: 180,
      maxBytes: WFS_MAX_BYTES,
      maxOutputBytes: 64 * 1024 * 1024,
      maxRecordBytes: 1024 * 1024,
      maxRecords: 5000,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 86_400,
  /** Every six hours: the burnt areas EFFIS dates within the last 180 days in Portugal, page by page from its WFS. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The burnt-area polygons into one event per fire. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
