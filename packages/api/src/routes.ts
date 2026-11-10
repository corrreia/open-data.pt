import { z } from "zod";

import {
  AcquisitionDaySchema,
  AcquisitionListSchema,
  AllRecordsSchema,
  AnalyticsReportSchema,
  ChangeListSchema,
  FeatureCollectionSchema,
  FeedListSchema,
  FeedResponseSchema,
  HistoryPageSchema,
  LakeChangeSchema,
  LakeSeriesChangeSchema,
  OutagesResponseSchema,
  ProductListSchema,
  ProductSchema,
  RecordListSchema,
  RecordSchema,
  SeriesChangeListSchema,
  SeriesPointListSchema,
  SeriesPointSchema,
  SeriesSummarySchema,
} from "./schemas";

export const MAX_FILTERS = 5;
export const MAX_HISTORY_WINDOW_DAYS = 366;

export interface IntegerQueryDefinition {
  default: number;
  minimum: number;
  maximum: number;
  values?: readonly number[];
}

export interface QueryParameterDefinition {
  name: string;
  description: string;
  repeatable?: boolean;
  required?: boolean;
  integer?: IntegerQueryDefinition;
}

export type ApiCachePolicy =
  | { kind: "none" }
  | { kind: "fixed"; seconds: number }
  | { kind: "current-product"; seconds: number }
  | { kind: "history" }
  | { kind: "acquisitions" }
  | { kind: "summary" }
  | { kind: "summary-file" };

export interface ApiRouteDefinition {
  path: string;
  pattern: RegExp;
  query: readonly QueryParameterDefinition[];
  costly?: boolean;
  costlyWith?: readonly string[];
  responseSchema: z.ZodType;
  responseMediaType?: string;
  cache: ApiCachePolicy;
  openapi: { operationId: string; tags: readonly string[]; summary: string };
}

const query = (name: string, description: string): QueryParameterDefinition => ({ name, description });
const integer = (name: string, description: string, defaultValue: number, minimum: number, maximum: number, values?: readonly number[]): QueryParameterDefinition => ({
  name,
  description,
  integer: values ? { default: defaultValue, minimum, maximum, values } : { default: defaultValue, minimum, maximum },
});
const required = (name: string, description: string): QueryParameterDefinition => ({ name, description, required: true });
const repeatable = (name: string, description: string): QueryParameterDefinition => ({ name, description, repeatable: true });
const noCache: ApiCachePolicy = { kind: "none" };
const fixed = (seconds: number): ApiCachePolicy => ({ kind: "fixed", seconds });
const currentProduct = (seconds: number): ApiCachePolicy => ({ kind: "current-product", seconds });
const history: ApiCachePolicy = { kind: "history" };
const acquisitions: ApiCachePolicy = { kind: "acquisitions" };
const summary: ApiCachePolicy = { kind: "summary" };
const summaryFile: ApiCachePolicy = { kind: "summary-file" };
const jsonAny = z.record(z.string(), z.json());
const historyWindow = [
  required("from", "Inclusive RFC 3339 lower bound."),
  required("to", `Exclusive RFC 3339 upper bound, at most ${MAX_HISTORY_WINDOW_DAYS} days after from.`),
  query("cursor", "Opaque continuation cursor."),
] as const;
const rowFilters = [repeatable("where", `field:value equality; repeat for up to ${MAX_FILTERS} filters.`), query("bbox", "minLon,minLat,maxLon,maxLat in degrees.")] as const;

/**
 * The public route contract used by request guards, cache policy and OpenAPI.
 * First match wins, so exports and history precede the plain product route.
 */
export const API_ROUTES: readonly ApiRouteDefinition[] = [
  {
    path: "/api",
    pattern: /^\/api\/?$/,
    query: [],
    responseSchema: jsonAny,
    cache: noCache,
    openapi: { operationId: "getApiIndex", tags: ["Platform"], summary: "Where to start: links to products, documentation and history" },
  },
  {
    path: "/api/health",
    pattern: /^\/api\/health$/,
    query: [],
    responseSchema: z.object({ status: z.literal("ok") }),
    cache: noCache,
    openapi: { operationId: "getHealth", tags: ["Platform"], summary: "Liveness check" },
  },
  {
    path: "/api/products",
    pattern: /^\/api\/products$/,
    query: [],
    responseSchema: ProductListSchema,
    cache: fixed(20),
    openapi: { operationId: "listProducts", tags: ["Products"], summary: "List cleaned products, current views, series, and summaries" },
  },
  {
    path: "/api/feeds",
    pattern: /^\/api\/feeds$/,
    query: [],
    responseSchema: FeedListSchema,
    cache: fixed(10),
    openapi: { operationId: "listFeeds", tags: ["Feeds"], summary: "List public feeds with their schedule and freshness" },
  },
  {
    path: "/api/catalog.dcat.json",
    pattern: /^\/api\/catalog\.dcat\.json$/,
    query: [],
    responseSchema: jsonAny,
    responseMediaType: "application/ld+json",
    cache: fixed(300),
    openapi: { operationId: "getDcatCatalog", tags: ["Products"], summary: "Get a DCAT 3 JSON-LD projection of published products" },
  },
  {
    path: "/api/outages",
    pattern: /^\/api\/outages$/,
    query: [integer("days", "Number of days in the outage window.", 90, 1, 90)],
    responseSchema: OutagesResponseSchema,
    cache: noCache,
    openapi: { operationId: "listOutages", tags: ["Feeds"], summary: "List source, collection and platform outages" },
  },
  {
    path: "/api/analytics",
    pattern: /^\/api\/analytics$/,
    query: [integer("days", "Window: 1, 7, 30 or 90 days.", 7, 1, 90, [1, 7, 30, 90])],
    responseSchema: AnalyticsReportSchema,
    cache: fixed(1800),
    openapi: { operationId: "getAnalytics", tags: ["Platform"], summary: "Report aggregate usage of the site, API and MCP server" },
  },
  {
    path: "/api/acquisitions",
    pattern: /^\/api\/acquisitions$/,
    query: [query("day", "Optional UTC calendar day, YYYY-MM-DD."), query("feedId", "Optional feed ID."), integer("limit", "Maximum runs returned.", 50, 1, 1000)],
    responseSchema: z.union([AcquisitionListSchema, AcquisitionDaySchema]),
    cache: acquisitions,
    openapi: { operationId: "listAcquisitions", tags: ["Feeds"], summary: "List collection runs across public feeds or for one UTC day" },
  },
  {
    path: "/api/feeds/{feedId}",
    pattern: /^\/api\/feeds\/[^/]+$/,
    query: [],
    responseSchema: FeedResponseSchema,
    cache: fixed(10),
    openapi: { operationId: "getFeed", tags: ["Feeds"], summary: "Get one feed with its latest runtime status" },
  },
  {
    path: "/api/products/{slug}.geojson",
    pattern: /^\/api\/products\/[^/]+\.geojson$/,
    query: rowFilters,
    costly: true,
    responseSchema: FeatureCollectionSchema,
    responseMediaType: "application/geo+json",
    cache: currentProduct(15),
    openapi: { operationId: "getProductGeoJson", tags: ["Products"], summary: "Stream a product as GeoJSON" },
  },
  {
    path: "/api/products/{slug}.parquet",
    pattern: /^\/api\/products\/[^/]+\.parquet$/,
    query: [],
    costly: true,
    responseSchema: z.instanceof(Uint8Array),
    responseMediaType: "application/vnd.apache.parquet",
    cache: currentProduct(15),
    openapi: { operationId: "getProductParquet", tags: ["Products"], summary: "Download every current record as Parquet" },
  },
  {
    path: "/api/products/{slug}/records/all",
    pattern: /^\/api\/products\/[^/]+\/records\/all$/,
    query: rowFilters,
    costly: true,
    responseSchema: AllRecordsSchema,
    cache: currentProduct(15),
    openapi: { operationId: "listAllProductRecords", tags: ["Products"], summary: "Stream every current record in one response" },
  },
  {
    path: "/api/products/{slug}/records",
    pattern: /^\/api\/products\/[^/]+\/records$/,
    query: [
      integer("limit", "Maximum records returned.", 50, 1, 500),
      query("cursor", "Opaque cursor from nextCursor."),
      query("validAt", "Only records valid at this RFC 3339 time."),
      ...rowFilters,
    ],
    costlyWith: ["validAt", "where", "bbox"],
    responseSchema: RecordListSchema,
    cache: currentProduct(15),
    openapi: { operationId: "listProductRecords", tags: ["Products"], summary: "Read current reference, state, summary, or event records" },
  },
  {
    path: "/api/products/{slug}/changes",
    pattern: /^\/api\/products\/[^/]+\/changes$/,
    query: [query("knownAt", "Only changes known at or before this RFC 3339 time."), integer("limit", "Maximum changes returned.", 100, 1, 500)],
    responseSchema: ChangeListSchema,
    cache: currentProduct(15),
    openapi: { operationId: "listProductChanges", tags: ["Products"], summary: "Read recent record changes" },
  },
  {
    path: "/api/products/{slug}/series",
    pattern: /^\/api\/products\/[^/]+\/series$/,
    query: [
      query("seriesKey", "Optional series key."),
      query("from", "Inclusive event-time lower bound."),
      query("to", "Inclusive event-time upper bound."),
      integer("limit", "Maximum points returned.", 100, 1, 1000),
    ],
    responseSchema: SeriesPointListSchema,
    cache: currentProduct(15),
    openapi: { operationId: "listProductSeries", tags: ["Products"], summary: "Read the recent window of time-series points" },
  },
  {
    path: "/api/products/{slug}/series/changes",
    pattern: /^\/api\/products\/[^/]+\/series\/changes$/,
    query: [
      query("seriesKey", "Optional series key."),
      query("from", "Inclusive event-time lower bound."),
      query("to", "Inclusive event-time upper bound."),
      integer("limit", "Maximum corrections returned.", 100, 1, 1000),
    ],
    responseSchema: SeriesChangeListSchema,
    cache: currentProduct(15),
    openapi: { operationId: "listProductSeriesChanges", tags: ["Products"], summary: "Read recent time-series corrections" },
  },
  {
    path: "/api/products/{slug}/events",
    pattern: /^\/api\/products\/[^/]+\/events$/,
    query: [...historyWindow, query("knownAt", "Read the window as known at this RFC 3339 time."), integer("limit", "Maximum events returned.", 200, 1, 500)],
    costly: true,
    responseSchema: HistoryPageSchema(RecordSchema),
    cache: history,
    openapi: { operationId: "listProductEvents", tags: ["Products"], summary: "Read applicable event revisions over an event-time window" },
  },
  {
    path: "/api/products/{slug}/changes/range",
    pattern: /^\/api\/products\/[^/]+\/changes\/range$/,
    query: [...historyWindow, query("seriesKey", "Time-series products only: one series key."), integer("limit", "Maximum revisions returned.", 200, 1, 500)],
    costly: true,
    responseSchema: HistoryPageSchema(z.union([LakeChangeSchema, LakeSeriesChangeSchema])),
    cache: history,
    openapi: { operationId: "listProductChangeRange", tags: ["Products"], summary: "Read revisions over a knowledge-time window" },
  },
  {
    path: "/api/products/{slug}/series/summary",
    pattern: /^\/api\/products\/[^/]+\/series\/summary$/,
    query: [
      required("from", "Inclusive RFC 3339 lower bound."),
      required("to", "Exclusive RFC 3339 upper bound."),
      query("resolution", "hour, day or month."),
      repeatable("seriesKey", "Up to ten series keys."),
    ],
    responseSchema: SeriesSummarySchema,
    cache: summary,
    openapi: { operationId: "getProductSeriesSummary", tags: ["Products"], summary: "Read a time-series window summarised by hour, Lisbon day or month" },
  },
  {
    path: "/api/products/{slug}/series/summary/{period}",
    pattern: /^\/api\/products\/[^/]+\/series\/summary\/\d{4}(?:-\d{2})?$/,
    query: [],
    responseSchema: jsonAny,
    cache: summaryFile,
    openapi: { operationId: "getProductSeriesSummaryFile", tags: ["Products"], summary: "Download one stored month or year of summaries" },
  },
  {
    path: "/api/products/{slug}/series/range",
    pattern: /^\/api\/products\/[^/]+\/series\/range$/,
    query: [
      ...historyWindow,
      query("knownAt", "Read the window as known at this RFC 3339 time."),
      query("seriesKey", "Optional series key."),
      integer("limit", "Maximum points returned.", 500, 1, 1000),
    ],
    costly: true,
    responseSchema: HistoryPageSchema(SeriesPointSchema),
    cache: history,
    openapi: { operationId: "listProductSeriesRange", tags: ["Products"], summary: "Read time-series state over an event-time window" },
  },
  {
    path: "/api/products/{slug}/series/changes/range",
    pattern: /^\/api\/products\/[^/]+\/series\/changes\/range$/,
    query: [...historyWindow, query("seriesKey", "Optional series key."), integer("limit", "Maximum revisions returned.", 500, 1, 1000)],
    costly: true,
    responseSchema: HistoryPageSchema(LakeSeriesChangeSchema),
    cache: history,
    openapi: { operationId: "listProductSeriesChangeRange", tags: ["Products"], summary: "Read point revisions over a knowledge-time window" },
  },
  {
    path: "/api/products/{slug}",
    pattern: /^\/api\/products\/[^/]+$/,
    query: [],
    responseSchema: ProductSchema,
    cache: fixed(20),
    openapi: { operationId: "getProduct", tags: ["Products"], summary: "Get one published product" },
  },
];

export function apiRouteAt(pathname: string): ApiRouteDefinition | undefined {
  return API_ROUTES.find((route) => route.pattern.test(pathname));
}

/** The integer bounds one route declares for a query parameter. */
export function integerQueryAt(pathname: string, name: string): IntegerQueryDefinition | undefined {
  return apiRouteAt(pathname)?.query.find((parameter) => parameter.name === name)?.integer;
}
