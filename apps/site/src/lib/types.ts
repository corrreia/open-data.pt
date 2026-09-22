// The API's shapes, as `@open-data-pt/api` declares them for both sides: the kernel builds its
// responses against those types, so what the pages read here is what the kernel sends. Only the
// site's own aliases live in this file.

export type {
  Acquisition,
  AcquisitionDay,
  AcquisitionStatus,
  AnalyticsReport,
  Change,
  Coverage,
  CursorPage,
  Feature,
  FeatureCollection,
  Feed,
  Field,
  FieldDisplay,
  Geometry,
  HistoryPage,
  JsonValue,
  LakeChange,
  LakeSeriesPoint,
  List,
  Outage,
  OutageCause,
  OutagesResponse,
  Product,
  Role,
  SeriesChange,
  SeriesPoint,
  SeriesSummary,
  SummaryBucket,
  SummaryResolution,
  Term,
} from "@open-data-pt/api";

/** The site's name for a decoded JSON object: one record, one row, one payload. */
export type { JsonObject as JsonRecord } from "@open-data-pt/api";
