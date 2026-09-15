import { NormalizedInputError, type CanonicalRecord, type JsonObject } from "@open-data-pt/gatekeeper-shared";

import { digest, stableStringify } from "./hash";
import type { ChangeItem } from "./object-store";

/** Everything needed to classify one record product's rows within one acquisition. */
export interface RecordContext {
  feedId: string;
  acquisitionId: string;
  slug: string;
  /** The version this acquisition would publish. */
  productVersion: number;
  observedAt: string;
  normalizer: { id: string; version: string };
  /** Batch-level publication time; stamped on changed rows, never part of their identity. */
  sourcePublishedAt?: string;
  /** The product has no previous state: every row is a baseline, not a create. */
  baseline: boolean;
  /** Whether revisions of this product go to history at all. */
  keepHistory: boolean;
}

/** One incoming record reduced to what comparison and serving need. */
export interface PreparedRecord {
  key: string;
  /** Semantic hash: payload, operation, validity and the record's own source clocks. */
  hash: string;
  removal: boolean;
  record: CanonicalRecord;
}

export function prepareRecord(record: CanonicalRecord): PreparedRecord {
  const semantic = stableStringify({
    operation: record.operation ?? "upsert",
    payload: record.payload,
    eventTime: record.eventTime ?? null,
    validFrom: record.validFrom ?? null,
    validTo: record.validTo ?? null,
    sourcePublishedAt: record.sourcePublishedAt ?? null,
    sourceSequence: record.sourceSequence ?? null,
  });
  const removal = record.operation === "delete" || record.operation === "retract";
  return { key: record.entityKey, hash: digest(semantic), removal, record };
}

/**
 * The served JSON of a changed row. `_time.observed` is when this value was
 * first observed; an unchanged row keeps its earlier JSON, so unchanged chunks
 * stay byte-identical across collections.
 */
export function servingJson(prepared: PreparedRecord, context: RecordContext): string {
  const record = prepared.record;
  if (Object.hasOwn(record.payload, "id") || Object.hasOwn(record.payload, "_hash") || Object.hasOwn(record.payload, "_time")) {
    const { id: _id, _hash: _h, _time: _t, ...payload } = record.payload;
    return JSON.stringify({ ...payload, id: prepared.key, _hash: prepared.hash, _time: timeOf(record, context) });
  }
  return JSON.stringify({ ...record.payload, id: prepared.key, _hash: prepared.hash, _time: timeOf(record, context) });
}

function timeOf(record: CanonicalRecord, context: RecordContext): JsonObject {
  return {
    event: record.eventTime ?? null,
    validFrom: record.validFrom ?? null,
    validTo: record.validTo ?? null,
    sourcePublished: record.sourcePublishedAt ?? context.sourcePublishedAt ?? null,
    sequence: record.sourceSequence ?? null,
    observed: context.observedAt,
  };
}

export interface Revision {
  change: ChangeItem;
  lake: JsonObject;
}

export function recordRevision(prepared: PreparedRecord, existed: boolean, context: RecordContext): Revision {
  const record = prepared.record;
  const operation = context.baseline ? "baseline" : record.operation ?? (existed ? "upsert" : "create");
  const id = revisionId(context, prepared.key, "");
  const published = record.sourcePublishedAt ?? context.sourcePublishedAt ?? null;
  const change: ChangeItem = {
    id,
    entityKey: prepared.key,
    operation,
    payload: record.payload,
    recordHash: prepared.hash,
    eventTime: record.eventTime ?? null,
    validFrom: record.validFrom ?? null,
    validTo: record.validTo ?? null,
    sourcePublishedAt: published,
    sourceSequence: record.sourceSequence ?? null,
    observedAt: context.observedAt,
    ingestedAt: context.observedAt,
    acquisitionId: context.acquisitionId,
  };
  const lake: JsonObject = {
    batch_id: context.acquisitionId, revision_id: id, feed_id: context.feedId, product_slug: context.slug,
    product_version: context.productVersion, normalizer_id: context.normalizer.id, normalizer_version: context.normalizer.version,
    schema: {}, entity_key: prepared.key, operation, observed_at: context.observedAt, ingested_at: context.observedAt,
    acquisition_id: context.acquisitionId, payload: historyPayload(record.payload, record.sourceSequence ?? null),
  };
  if (record.eventTime) lake.event_time = record.eventTime;
  if (record.validFrom) lake.valid_from = record.validFrom;
  if (record.validTo) lake.valid_to = record.validTo;
  if (published) lake.source_published_at = published;
  return { change, lake };
}

/** An entity missing from an authoritative complete snapshot. */
export function retractionRevision(key: string, context: RecordContext): Revision {
  const id = revisionId(context, key, "|retract");
  const change: ChangeItem = {
    id, entityKey: key, operation: "retract", payload: null, recordHash: `retract:${context.acquisitionId}:${key}`,
    eventTime: null, validFrom: null, validTo: null, sourcePublishedAt: null, sourceSequence: null,
    observedAt: context.observedAt, ingestedAt: context.observedAt, acquisitionId: context.acquisitionId,
  };
  const lake: JsonObject = {
    batch_id: context.acquisitionId, revision_id: id, feed_id: context.feedId, product_slug: context.slug,
    product_version: context.productVersion, normalizer_id: context.normalizer.id, normalizer_version: context.normalizer.version,
    schema: {}, entity_key: key, operation: "retract", observed_at: context.observedAt, ingested_at: context.observedAt,
    acquisition_id: context.acquisitionId, payload: {},
  };
  return { change, lake };
}

export function revisionId(context: Pick<RecordContext, "acquisitionId" | "slug">, key: string, suffix: string): string {
  return `rev_${digest(`${context.acquisitionId}|${context.slug}|${key}${suffix}`)}`;
}

const SOURCE_SEQUENCE_FIELD = "__openDataSourceSequence";

function historyPayload(payload: JsonObject, sourceSequence: string | null): JsonObject {
  if (Object.hasOwn(payload, SOURCE_SEQUENCE_FIELD)) throw new NormalizedInputError(`Source payload cannot use reserved field ${SOURCE_SEQUENCE_FIELD}`);
  return sourceSequence === null ? payload : { ...payload, [SOURCE_SEQUENCE_FIELD]: sourceSequence };
}

/** Keep the newest `limit` change items, newest first. */
export class RecentChanges<T> {
  private items: T[] = [];
  constructor(private readonly limit: number) {}
  add(item: T): void {
    this.items.push(item);
    if (this.items.length > this.limit * 2) this.items = this.items.slice(-this.limit);
  }
  addAll(items: readonly T[]): void {
    for (const item of items) this.add(item);
  }
  newestFirst(): T[] {
    return this.items.slice(-this.limit).reverse();
  }
  get size(): number {
    return Math.min(this.items.length, this.limit);
  }
}
