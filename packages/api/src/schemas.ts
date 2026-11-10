import type { JsonValue as ContractJsonValue } from "@open-data-pt/contract/data";
import { z } from "zod";

const jsonSchema: z.ZodType<ContractJsonValue> = z.json();
const jsonObjectSchema = z.record(z.string(), jsonSchema);
const timeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Expected an ISO 8601 date-time");
const nullableTimeSchema = timeSchema.nullable();
const nonNegativeIntegerSchema = z.int().nonnegative();

export const FieldDisplaySchema = z.object({
  badge: z.object({ colorField: z.string(), textColorField: z.string().optional() }).optional(),
  label: z.string().optional(),
});

export const FieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["boolean", "category", "color", "date", "datetime", "geometry", "identifier", "json", "latitude", "longitude", "number", "string", "url"]),
  nullable: z.boolean(),
  unit: z.string().optional(),
  display: FieldDisplaySchema.optional(),
});

export const CanonicalSchemaSchema = z.object({ fields: z.array(FieldSchema) });
export const RoleSchema = z.enum(["current-state", "event-log", "reference", "summary", "time-series"]);
const completenessSchema = z.enum(["complete", "partial", "unknown"]);
const qualitySchema = z.object({ acceptedRecords: nonNegativeIntegerSchema, rejectedRecords: nonNegativeIntegerSchema });

export const TermSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
});

export const ProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  feedId: z.string(),
  title: z.string(),
  description: z.string(),
  role: RoleSchema,
  schema: CanonicalSchemaSchema,
  version: nonNegativeIntegerSchema,
  status: z.enum(["current", "failed"]),
  currentAcquisitionId: z.string().nullable(),
  watermark: nullableTimeSchema,
  rowCount: nonNegativeIntegerSchema,
  completeness: completenessSchema,
  stale: z.boolean(),
  staleAfterSeconds: nonNegativeIntegerSchema,
  cadenceSeconds: nonNegativeIntegerSchema,
  historyMode: z.enum(["changes", "latest"]),
  exposeHistory: z.boolean(),
  licence: TermSchema.nullable(),
  attribution: z.string().nullable(),
  hasChanges: z.boolean(),
  hasSeries: z.boolean(),
  updatedAt: timeSchema,
});

export const AcquisitionStatusSchema = z.enum(["failed", "queued", "running", "succeeded", "unchanged"]);

export const FeedSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  publisher: TermSchema,
  licence: TermSchema,
  attribution: z.string().optional(),
  topics: z.array(z.string()),
  format: z.string().trim().min(1),
  cadenceSeconds: nonNegativeIntegerSchema,
  enabled: z.boolean(),
  staleAfterSeconds: nonNegativeIntegerSchema,
  createdAt: timeSchema,
  updatedAt: timeSchema,
  sourceUrl: z.string().optional(),
  lastSuccessAt: timeSchema.optional(),
  lastAttemptAt: timeSchema.optional(),
  nextRunAt: timeSchema.optional(),
  running: z.boolean().optional(),
  consecutiveFailures: nonNegativeIntegerSchema.optional(),
  lastAcquisitionStatus: AcquisitionStatusSchema.optional(),
});

export const AcquisitionSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  trigger: z.string(),
  status: AcquisitionStatusSchema,
  requestedAt: timeSchema,
  startedAt: timeSchema.optional(),
  completedAt: timeSchema.optional(),
  observedAt: timeSchema.optional(),
  eventTime: timeSchema.optional(),
  sourcePublishedAt: timeSchema.optional(),
  completeness: completenessSchema.optional(),
  normalizer: z.object({ id: z.string(), version: z.string() }).optional(),
  quality: qualitySchema.optional(),
  rows: nonNegativeIntegerSchema.optional(),
  revisions: nonNegativeIntegerSchema.optional(),
  error: z.string().optional(),
});

export const AcquisitionDaySchema = z.object({ day: z.string(), complete: z.boolean(), data: z.array(AcquisitionSchema) });
export const OutageCauseSchema = z.enum(["source", "collection", "platform"]);
export const OutageSchema = z.object({
  feedId: z.string().nullable(),
  startedAt: timeSchema,
  endedAt: timeSchema.optional(),
  cause: OutageCauseSchema,
  failures: nonNegativeIntegerSchema,
  lastError: z.string().optional(),
});
export const OutagesResponseSchema = z.object({ from: timeSchema, to: timeSchema, trackedSince: nullableTimeSchema, data: z.array(OutageSchema) });

export const ChangeSchema = z.object({
  id: z.string(),
  entityKey: z.string(),
  operation: z.string(),
  payload: jsonObjectSchema.nullable(),
  recordHash: z.string(),
  eventTime: nullableTimeSchema,
  validFrom: nullableTimeSchema,
  validTo: nullableTimeSchema,
  sourcePublishedAt: nullableTimeSchema,
  sourceSequence: z.string().nullable(),
  observedAt: timeSchema,
  ingestedAt: timeSchema,
  acquisitionId: z.string(),
});

export const LakeChangeSchema = z.object({
  revisionId: z.string(),
  entityKey: z.string(),
  operation: z.string(),
  eventTime: nullableTimeSchema,
  validFrom: nullableTimeSchema,
  validTo: nullableTimeSchema,
  sourcePublishedAt: nullableTimeSchema,
  sourceSequence: z.string().nullable(),
  observedAt: timeSchema,
  ingestedAt: timeSchema,
  payload: jsonObjectSchema.nullable(),
});

export const SeriesPointSchema = z.object({
  seriesKey: z.string(),
  eventTime: timeSchema,
  value: z.number(),
  unit: z.string(),
  dimensions: z.record(z.string(), z.string()),
  observedAt: timeSchema,
});
export const SeriesChangeSchema = SeriesPointSchema.extend({
  id: z.string(),
  ingestedAt: timeSchema,
  acquisitionId: z.string(),
  previousValue: z.number().nullable(),
});
export const LakeSeriesPointSchema = z.object({
  seriesKey: z.string(),
  eventTime: timeSchema,
  value: z.number(),
  unit: z.string(),
  dimensions: jsonObjectSchema,
  observedAt: timeSchema,
});
export const LakeSeriesChangeSchema = LakeSeriesPointSchema.extend({ revisionId: z.string(), ingestedAt: timeSchema });

export const FreshnessSchema = z.object({ updatedAt: timeSchema, stale: z.boolean() });
export const CoverageSchema = z.object({
  requested: z.object({ from: timeSchema, to: timeSchema }),
  lakeStartsAt: nullableTimeSchema,
  coveredFrom: nullableTimeSchema,
  complete: z.boolean(),
  reason: z.string().nullable(),
});

export const HistoryPageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
    snapshotAt: timeSchema,
    knownAt: nullableTimeSchema.optional(),
    freshness: FreshnessSchema,
    coverage: CoverageSchema,
    source: z.literal("lake"),
  });

export const SummaryResolutionSchema = z.enum(["hour", "day", "month"]);
export const SummaryBucketSchema = z.object({ start: timeSchema, count: nonNegativeIntegerSchema, mean: z.number(), min: z.number(), max: z.number() });
export const SummarySeriesSchema = z.object({ seriesKey: z.string(), unit: z.string(), dimensions: jsonSchema, buckets: z.array(SummaryBucketSchema) });
export const SummaryCoverageSchema = z.object({ firstDay: z.string().nullable(), through: z.string().nullable(), until: nullableTimeSchema });
export const SeriesSummarySchema = z.object({
  resolution: SummaryResolutionSchema,
  timeZone: z.string(),
  from: timeSchema,
  to: timeSchema,
  coverage: SummaryCoverageSchema,
  series: z.array(SummarySeriesSchema),
});

export const GeometrySchema: z.ZodType<Geometry> = z.lazy(() => z.object({ type: z.string(), coordinates: jsonSchema.optional(), geometries: z.array(GeometrySchema).optional() }));
export const FeatureSchema = z.object({ type: z.literal("Feature"), id: z.string().optional(), geometry: GeometrySchema, properties: jsonObjectSchema });
export const FeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  numberMatched: nonNegativeIntegerSchema.optional(),
  numberReturned: nonNegativeIntegerSchema,
  timeStamp: timeSchema,
  features: z.array(FeatureSchema),
});

const countSchema = z.number().nonnegative();
export const AnalyticsReportSchema = z.object({
  days: z.int().positive(),
  resolution: z.enum(["hour", "day"]),
  from: timeSchema,
  to: timeSchema,
  retentionDays: z.int().positive(),
  timeline: z.array(z.object({ time: timeSchema, surface: z.string(), kind: z.string(), requests: countSchema })),
  clients: z.array(z.object({ surface: z.string(), kind: z.string(), name: z.string(), requests: countSchema })),
  routes: z.array(z.object({ surface: z.string(), route: z.string(), requests: countSchema, meanMs: z.number().nonnegative() })),
  subjects: z.array(z.object({ surface: z.string(), route: z.string(), subject: z.string(), requests: countSchema })),
  countries: z.array(z.object({ surface: z.string(), country: z.string(), requests: countSchema })),
  referrers: z.array(z.object({ surface: z.string(), referrer: z.string(), medium: z.string(), requests: countSchema })),
  outcomes: z.array(z.object({ surface: z.string(), status: z.string(), cache: z.string(), format: z.string(), requests: countSchema })),
  mcp: z.array(z.object({ call: z.string(), client: z.string(), requests: countSchema })),
  ask: z.array(z.object({ turn: z.string(), model: z.string(), status: z.string(), requests: countSchema })),
});

export const ProblemSchema = z.object({ type: z.string(), title: z.string(), status: z.int(), detail: z.string() });
export const ProductListSchema = z.object({ data: z.array(ProductSchema) });
export const FeedListSchema = z.object({ data: z.array(FeedSchema) });
export const FeedResponseSchema = z.object({ data: FeedSchema });
export const AcquisitionListSchema = z.object({ data: z.array(AcquisitionSchema) });
export const ChangeListSchema = z.object({ data: z.array(ChangeSchema) });
export const SeriesPointListSchema = z.object({ data: z.array(SeriesPointSchema) });
export const SeriesChangeListSchema = z.object({ data: z.array(SeriesChangeSchema) });
export const RecordSchema = jsonObjectSchema;
export const RecordListSchema = z.object({ data: z.array(RecordSchema), nextCursor: z.string().optional() });
export const AllRecordsSchema = z.object({ numberMatched: nonNegativeIntegerSchema.optional(), data: z.array(RecordSchema), numberReturned: nonNegativeIntegerSchema });

export type FieldDisplay = z.infer<typeof FieldDisplaySchema>;
export type Field = z.infer<typeof FieldSchema>;
export type CanonicalSchema = z.infer<typeof CanonicalSchemaSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Term = z.infer<typeof TermSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type AcquisitionStatus = z.infer<typeof AcquisitionStatusSchema>;
export type Feed = z.infer<typeof FeedSchema>;
export type Acquisition = z.infer<typeof AcquisitionSchema>;
export type AcquisitionDay = z.infer<typeof AcquisitionDaySchema>;
export type OutageCause = z.infer<typeof OutageCauseSchema>;
export type Outage = z.infer<typeof OutageSchema>;
export type OutagesResponse = z.infer<typeof OutagesResponseSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type LakeChange = z.infer<typeof LakeChangeSchema>;
export type SeriesPoint = z.infer<typeof SeriesPointSchema>;
export type SeriesChange = z.infer<typeof SeriesChangeSchema>;
export type LakeSeriesPoint = z.infer<typeof LakeSeriesPointSchema>;
export type LakeSeriesChange = z.infer<typeof LakeSeriesChangeSchema>;
export type Freshness = z.infer<typeof FreshnessSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type HistoryPage<T> = {
  data: T[];
  nextCursor: string | null;
  snapshotAt: string;
  knownAt?: string | null;
  freshness: Freshness;
  coverage: Coverage;
  source: "lake";
};
export type SummaryResolution = z.infer<typeof SummaryResolutionSchema>;
export type SummaryBucket = z.infer<typeof SummaryBucketSchema>;
export type SummarySeries = z.infer<typeof SummarySeriesSchema>;
export type SummaryCoverage = z.infer<typeof SummaryCoverageSchema>;
export type SeriesSummary = z.infer<typeof SeriesSummarySchema>;
export interface Geometry {
  type: string;
  coordinates?: z.infer<typeof jsonSchema> | undefined;
  geometries?: Geometry[] | undefined;
}
export type Feature = z.infer<typeof FeatureSchema>;
export type FeatureCollection = z.infer<typeof FeatureCollectionSchema>;
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;
export type Problem = z.infer<typeof ProblemSchema>;

export interface List<T> {
  data: T[];
}

export interface CursorPage<T> {
  data: T[];
  nextCursor?: string;
}

export type JsonObject = z.infer<typeof jsonObjectSchema>;
export type JsonValue = z.infer<typeof jsonSchema>;
export type FieldType = Field["type"];
