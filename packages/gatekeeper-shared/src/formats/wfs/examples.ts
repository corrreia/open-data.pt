import type { ExampleFeed } from "../../index";
import { WFS_MAX_BYTES } from "./wfs";

export const WFS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "effis-portugal-recent-burnt-areas-feed",
    title: "Recent EFFIS burnt areas in Portugal",
    description:
      "Burnt-area polygons attributed to Portugal in the continuously updated EFFIS MODIS database during the past 180 days, with fire dates, latest update, hectares and land-cover shares. Satellite-derived burnt areas are not emergency-service incident perimeters.",
    config: {
      source: "wfs",
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
    publisher: "effis-jrc",
    topics: ["environment"],
    staleAfterSeconds: 86_400,
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
      serving: { licence: "cc-by-4.0", attribution: "European Forest Fire Information System (EFFIS), European Commission Joint Research Centre" },
    },
  },
];
