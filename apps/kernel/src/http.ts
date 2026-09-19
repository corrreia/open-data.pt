import { asObject, asString, isJsonString, parseJson, type JsonObject, type JsonValue } from "@open-data-pt/gatekeeper-shared";

import { CADENCE_HEADER } from "./cache";
import { REGISTRY_ROOM, type ProductDetail, type Registry } from "./coordinators";
import { publisherRef } from "./vocabulary";
import { NotFoundError, RequestError, type HeaderMap } from "./errors";
import type { Acquisition, Feed } from "./feed-model";
import { ObjectStore } from "./object-store";
import type { SnapshotStore } from "./ports";
import { MAX_HISTORY_PAGE, QueryError, runLakeQuery } from "./query";
import { readSummaryFile, readSummaryRange, type SummaryResolution } from "./summaries";
import { callRegistry, withHistorySlot } from "./registry-calls";
import { ALLOWED_METHODS, MAX_FILTERS, requestIdOf } from "./request-guard";
import {
  InvalidQueryError,
  Serving,
  publicProduct,
  type BoundingBox,
  type ChangeQuery,
  type FieldFilter,
  type ProductCatalog,
  type RecordQuery,
  type RowFilters,
  type SeriesQuery,
} from "./serving";

/** History windows are at most this long; longer spans take one request per window. */
const MAX_HISTORY_WINDOW_MS = 366 * 86_400_000;

export interface ApiContext {
  env: Env;
  snapshots: SnapshotStore;
  lakeQueryFetch?: typeof fetch;
}

type RegistryStub = DurableObjectStub<Registry>;

/**
 * The public API. It is read-only: the platform installs, schedules and
 * collects its feeds by itself, and nothing here changes it. Every endpoint is
 * open, needs no key, and answers GET, HEAD and OPTIONS only.
 */
export async function handleApi(request: Request, ctx: ApiContext): Promise<Response> {
  const url = new URL(request.url);
  const registry = (): RegistryStub => ctx.env.Registry.getByName(REGISTRY_ROOM);
  const serving = () => new Serving(publicCatalog(registry()), new ObjectStore(ctx.snapshots));

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": ALLOWED_METHODS,
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "GET") return problem(405, "Method not allowed", "The API is read-only; use GET.", { Allow: ALLOWED_METHODS });

    /* ---------- Platform ---------- */
    if (url.pathname === "/api/health") return json({ status: "ok" });
    if (url.pathname === "/api" || url.pathname === "/api/") {
      const product = `${url.origin}/api/products/{slug}`;
      return json({
        name: "open-data.pt",
        description: "Free, keyless, read-only JSON over Portuguese public data. Start with the product list; every endpoint is open.",
        free: true,
        authentication: "none",
        readOnly: true,
        start: `${url.origin}/start/`,
        llms: `${url.origin}/llms.txt`,
        openapi: `${url.origin}/openapi.json`,
        mcp: `${url.origin}/mcp`,
        products: `${url.origin}/api/products`,
        catalog: `${url.origin}/api/catalog.dcat.json`,
        history: {
          events: `${product}/events?from={iso}&to={iso}[&knownAt={iso}]`,
          series: `${product}/series/range?from={iso}&to={iso}[&knownAt={iso}][&seriesKey={key}]`,
          seriesChanges: `${product}/series/changes/range?from={iso}&to={iso}[&seriesKey={key}]`,
          changes: `${product}/changes/range?from={iso}&to={iso}`,
          maximumWindowDays: 366,
        },
      });
    }
    if (url.pathname === "/api/outages") {
      // When each feed's live collection kept failing, and when the platform collected nothing, over the last days.
      const days = parseInteger(url, "days", 90, 1, 90);
      const to = new Date().toISOString();
      const from = new Date(Date.parse(to) - days * 86_400_000).toISOString();
      const window = await registry().outages(from, to);
      return json({ from, to, trackedSince: window.trackedSince, data: window.items });
    }

    /* ---------- Feeds: where each dataset comes from, and how its collection is going ---------- */
    if (url.pathname === "/api/feeds") {
      const reg = registry();
      const [feeds, policies] = await Promise.all([reg.listFeeds(), reg.listPolicies()]);
      const cadences = new Map(policies.map((policy) => [policy.id, policy.collection.cadenceSeconds]));
      return json({ data: feeds.map((feed) => publicFeed(feed, cadences.get(feed.policyId))) });
    }
    const feedMatch = url.pathname.match(/^\/api\/feeds\/([^/]+)$/);
    if (feedMatch?.[1]) {
      const reg = registry();
      const [feed, policies] = await Promise.all([requireFeed(reg, decodeURIComponent(feedMatch[1])), reg.listPolicies()]);
      return json({ data: publicFeed(feed, policies.find((policy) => policy.id === feed.policyId)?.collection.cadenceSeconds) });
    }

    /* ---------- Collection runs, across feeds or of one, recent or of one UTC day ---------- */
    if (url.pathname === "/api/acquisitions") {
      // Served from the Registry's activity mirror: one object, not one call per runner.
      const feedId = optionalQuery(url, "feedId");
      const day = optionalQuery(url, "day");
      const reg = registry();
      if (day !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new RequestError("day must be a calendar date (YYYY-MM-DD)", 400);
        const limit = parseInteger(url, "limit", 500, 1, 1000);
        const start = `${day}T00:00:00.000Z`;
        const end = new Date(Date.parse(start) + 86_400_000).toISOString();
        const [activity, feeds] = await Promise.all([reg.activityBetween(start, end, limit, feedId), reg.listFeeds()]);
        const open = new Set(feeds.map((feed) => feed.id));
        return json({
          day,
          // Every run of the day: the mirror still reaches back to its start, and the limit cut nothing off.
          complete: activity.oldest !== null && activity.oldest <= start && !activity.more,
          data: activity.items.filter((acquisition) => open.has(acquisition.feedId)).map(publicAcquisition),
        });
      }
      const limit = parseInteger(url, "limit", 50, 1, 200);
      const [acquisitions, feeds] = await Promise.all([reg.listAcquisitions(limit, feedId), reg.listFeeds()]);
      const open = new Set(feeds.map((feed) => feed.id));
      return json({ data: acquisitions.filter((acquisition) => open.has(acquisition.feedId)).map(publicAcquisition) });
    }

    /* ---------- Products ---------- */
    if (url.pathname === "/api/catalog.dcat.json") {
      const reg = registry();
      const [feeds, policies] = await Promise.all([reg.listFeeds(), reg.listPolicies()]);
      return new Response(JSON.stringify(await serving().dcatCatalog(url.origin, feeds, policies)), {
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300", "Content-Type": "application/ld+json" },
      });
    }
    if (url.pathname === "/api/products") return json({ data: await serving().listProducts() });
    const geoJsonMatch = url.pathname.match(/^\/api\/products\/([^/]+)\.geojson$/);
    const allRecordsMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/records\/all$/);
    const historyMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/(events|changes\/range|series\/range|series\/changes\/range)$/);
    const summaryMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/series\/summary(?:\/(\d{4}(?:-\d{2})?))?$/);
    const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)(?:\/(records|changes|series|series\/changes))?$/);
    const slug = geoJsonMatch?.[1] ?? allRecordsMatch?.[1] ?? historyMatch?.[1] ?? summaryMatch?.[1] ?? productMatch?.[1];
    if (slug) {
      // One Registry call answers every product read: the entry, its chunk list, and whether the public may see it.
      const service = serving();
      const product = await service.product(decodeURIComponent(slug));
      if (!product) throw new NotFoundError("Product was not found");
      if (geoJsonMatch) {
        return withCadence(
          new Response(await service.geoJson(product, rowFilters(url)), {
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/geo+json" },
          }),
          product,
        );
      }
      if (allRecordsMatch) {
        return withCadence(
          new Response(await service.allRecords(product, rowFilters(url)), {
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
          }),
          product,
        );
      }
      if (summaryMatch) {
        requireHistory(product, "time-series");
        return await seriesSummary(ctx, url, product, summaryMatch[2]);
      }
      if (historyMatch?.[2]) return await history(ctx, registry, url, product, historyMatch[2]);
      const view = productMatch?.[2];
      if (!view) return withCadence(json(publicProduct(product)), product);
      if (view === "records") {
        const cursor = optionalQuery(url, "cursor");
        const validAt = optionalTime(url, "validAt");
        const filters = rowFilters(url);
        const query: RecordQuery = { limit: parseInteger(url, "limit", 50, 1, 500) };
        if (cursor) query.cursor = decodeCursor(cursor);
        if (validAt) query.validAt = validAt;
        if (filters) query.filters = filters;
        const page = await service.records(product, query);
        const body: JsonObject = { data: page.data };
        if (page.nextCursor) body.nextCursor = encodeCursor(page.nextCursor);
        return withCadence(json(body), product);
      }
      if (view === "changes") {
        requireHistory(product);
        const knownAt = optionalTime(url, "knownAt");
        const query: ChangeQuery = { limit: parseInteger(url, "limit", 100, 1, 500) };
        if (knownAt) query.knownAt = knownAt;
        return withCadence(json({ data: await service.changes(product, query) }), product);
      }
      if (view === "series/changes") requireHistory(product, "time-series");
      const seriesKey = optionalQuery(url, "seriesKey");
      const from = optionalTime(url, "from");
      const to = optionalTime(url, "to");
      const input: SeriesQuery = { limit: parseInteger(url, "limit", 100, 1, 1000) };
      if (seriesKey) input.seriesKey = seriesKey;
      if (from) input.from = from;
      if (to) input.to = to;
      return withCadence(json({ data: view === "series" ? await service.series(product, input) : await service.seriesChanges(product, input) }), product);
    }

    return problem(404, "Not found", "The requested endpoint does not exist.");
  } catch (error) {
    if (error instanceof NotFoundError) return problem(404, "Not found", error.message);
    if (error instanceof RequestError) return problem(error.status, error.status === 429 ? "Too many requests" : "Invalid request", error.message, error.headers);
    if (error instanceof InvalidQueryError) return problem(400, "Invalid request", error.message);
    if (error instanceof QueryError && error.failure === "disabled") return problem(503, "History unavailable", "History queries are not enabled on this deployment.");
    const message = error instanceof Error ? error.message : String(error);
    // Durable Object RPC keeps an error's message but not its class.
    if (/(^|\s)(was not found|not found)$/i.test(message)) return problem(404, "Not found", "The requested resource was not found.");
    const requestId = requestIdOf(request);
    console.error(JSON.stringify({ event: "api_request_failed", requestId, method: request.method, path: url.pathname, error: message }));
    if (error instanceof QueryError) {
      const failed = historyFailure(error.failure);
      return problem(failed.status, failed.title, `${failed.detail} Request ${requestId}.`, { "X-Request-Id": requestId });
    }
    return problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId });
  }
}

/* ---------- Series summaries ---------- */

const RESOLUTIONS = new Set(["hour", "day", "month"]);
const isResolution = (value: string): value is SummaryResolution => RESOLUTIONS.has(value);

/** A time series' summaries: one Lisbon month's or year's file as stored, or any window by hour, Lisbon day or Lisbon month. Both read R2 alone, never the lake. */
async function seriesSummary(ctx: ApiContext, url: URL, product: ProductDetail, period: string | undefined): Promise<Response> {
  const objects = new ObjectStore(ctx.snapshots);
  if (period) {
    const stored = await readSummaryFile(objects, product.slug, period);
    if (!stored) throw new NotFoundError(`No summary exists for ${period.length === 4 ? "that year" : "that month"}`);
    return json(stored);
  }
  const resolution = optionalQuery(url, "resolution");
  if (resolution !== undefined && !isResolution(resolution)) throw new RequestError("resolution must be hour, day or month", 400);
  return json(
    await readSummaryRange(objects, product.slug, { from: requiredDate(url, "from"), to: requiredDate(url, "to"), resolution, seriesKeys: url.searchParams.getAll("seriesKey") }),
  );
}

/* ---------- History ---------- */

/** The four typed history endpoints, all bounded to a 366-day window. */
async function history(ctx: ApiContext, registry: () => RegistryStub, url: URL, product: ProductDetail, endpoint: string): Promise<Response> {
  if (endpoint === "events") return eventRange(ctx, registry, url, product, await historicalFeed(registry, product, "event-log"));
  if (endpoint === "series/range") return seriesRange(ctx, registry, url, product, await historicalFeed(registry, product, "time-series"));
  if (endpoint === "series/changes/range") return seriesChangeRange(ctx, registry, url, product, await historicalFeed(registry, product, "time-series"));
  const feed = await historicalFeed(registry, product);
  // A series product's revisions are points; its records table is empty.
  if (product.role === "time-series") return seriesChangeRange(ctx, registry, url, product, feed);
  return recordChangeRange(ctx, registry, url, product, feed);
}

/** The applicable revision of each event in [from, to), as known now or at `knownAt`. */
async function eventRange(ctx: ApiContext, registry: () => RegistryStub, url: URL, product: HistoricalProduct, feed: Feed): Promise<Response> {
  const { from, to } = historyWindow(url);
  const knownAt = optionalTime(url, "knownAt");
  const limit = parseInteger(url, "limit", 200, 1, 500);
  const cursor = historyCursor(url);
  const start = await lakeStart(ctx, "records");
  const cursorClause = cursor
    ? ` AND (event_time < TIMESTAMP '${cursor.time}' OR (event_time = TIMESTAMP '${cursor.time}' AND entity_key > '${sqlString(cursor.key)}') OR (event_time = TIMESTAMP '${cursor.time}' AND entity_key = '${sqlString(cursor.key)}' AND revision_id < '${sqlString(cursor.revision)}'))`
    : "";
  const sql = `WITH ranked AS (SELECT revision_id, entity_key, operation, event_time, valid_from, valid_to, source_published_at, observed_at, ingested_at, payload, ROW_NUMBER() OVER (PARTITION BY entity_key ORDER BY observed_at DESC, revision_id DESC) AS rn FROM open_data.records WHERE feed_id = '${sqlString(product.feedId)}' AND product_slug = '${sqlString(product.slug)}'${ingestFloor(feed, from, start)} AND observed_at <= TIMESTAMP '${knownAt ?? new Date().toISOString()}') SELECT revision_id, entity_key, operation, event_time, valid_from, valid_to, source_published_at, observed_at, ingested_at, payload FROM ranked WHERE rn = 1 AND operation != 'retract' AND event_time >= TIMESTAMP '${from}' AND event_time < TIMESTAMP '${to}'${cursorClause} ORDER BY event_time DESC, entity_key ASC, revision_id DESC LIMIT ${limit + 1}`;
  const result = await runTypedHistoryQuery(registry, ctx, sql, `events:${product.slug}`);
  const page = result.rows.slice(0, limit).map((row) => ({
    ...lakePayload(row.payload),
    id: row.entity_key,
    operation: row.operation,
    eventTime: isoTime(row.event_time),
    sourcePublishedAt: isoTime(row.source_published_at) ?? null,
    sourceSequence: lakeSourceSequence(row.payload),
    observedAt: isoTime(row.observed_at),
    ingestedAt: isoTime(row.ingested_at),
  }));
  const last = result.rows[limit - 1];
  return json({
    data: page,
    nextCursor: result.rows.length > limit && last ? encodeHistoryCursor(String(last.event_time), String(last.entity_key), String(last.revision_id)) : null,
    knownAt: knownAt ?? null,
    freshness: { updatedAt: product.updatedAt, stale: product.stale },
    coverage: coverageFor(feed, from, to, start),
    source: "lake",
  });
}

/** Every record revision ingested in [from, to), newest knowledge first. */
async function recordChangeRange(ctx: ApiContext, registry: () => RegistryStub, url: URL, product: HistoricalProduct, feed: Feed): Promise<Response> {
  const { from, to } = historyWindow(url);
  const limit = parseInteger(url, "limit", 200, 1, 500);
  const cursor = historyCursor(url);
  const start = await lakeStart(ctx, "records");
  const cursorClause = cursor
    ? ` AND (observed_at < TIMESTAMP '${cursor.time}' OR (observed_at = TIMESTAMP '${cursor.time}' AND entity_key > '${sqlString(cursor.key)}') OR (observed_at = TIMESTAMP '${cursor.time}' AND entity_key = '${sqlString(cursor.key)}' AND revision_id < '${sqlString(cursor.revision)}'))`
    : "";
  // Knowledge time never precedes ingestion, so the ingest-day partitions before `from` can be skipped.
  const sql = `WITH unique_revisions AS (SELECT revision_id, entity_key, operation, event_time, valid_from, valid_to, source_published_at, observed_at, ingested_at, payload, ROW_NUMBER() OVER (PARTITION BY revision_id ORDER BY ingested_at DESC) AS duplicate_rank FROM open_data.records WHERE feed_id = '${sqlString(product.feedId)}' AND product_slug = '${sqlString(product.slug)}' AND __ingest_ts >= TIMESTAMP '${latest(from, start)}') SELECT revision_id, entity_key, operation, event_time, valid_from, valid_to, source_published_at, observed_at, ingested_at, payload FROM unique_revisions WHERE duplicate_rank = 1 AND observed_at >= TIMESTAMP '${from}' AND observed_at < TIMESTAMP '${to}'${cursorClause} ORDER BY observed_at DESC, entity_key ASC, revision_id DESC LIMIT ${limit + 1}`;
  const result = await runTypedHistoryQuery(registry, ctx, sql, `changes:${product.slug}`);
  const page = result.rows.slice(0, limit).map((row) => ({
    revisionId: row.revision_id,
    entityKey: row.entity_key,
    operation: row.operation,
    eventTime: isoTime(row.event_time) ?? null,
    validFrom: isoTime(row.valid_from) ?? null,
    validTo: isoTime(row.valid_to) ?? null,
    sourcePublishedAt: isoTime(row.source_published_at) ?? null,
    sourceSequence: lakeSourceSequence(row.payload),
    observedAt: isoTime(row.observed_at),
    ingestedAt: isoTime(row.ingested_at),
    payload: lakePayload(row.payload),
  }));
  const last = result.rows[limit - 1];
  return json({
    data: page,
    nextCursor: result.rows.length > limit && last ? encodeHistoryCursor(String(last.observed_at), String(last.entity_key), String(last.revision_id)) : null,
    freshness: { updatedAt: product.updatedAt, stale: product.stale },
    coverage: coverageFor(feed, from, to, start),
    source: "lake",
  });
}

/**
 * The value of each point with an event time in [from, to): the latest
 * revision now, or the latest one known at `knownAt`, so a window can be read
 * exactly as it was published at any past moment.
 */
async function seriesRange(ctx: ApiContext, registry: () => RegistryStub, url: URL, product: HistoricalProduct, feed: Feed): Promise<Response> {
  const { from, to } = historyWindow(url);
  const knownAt = optionalTime(url, "knownAt");
  const seriesKey = optionalQuery(url, "seriesKey");
  const limit = parseInteger(url, "limit", 500, 1, MAX_HISTORY_PAGE);
  const cursor = historyCursor(url);
  const start = await lakeStart(ctx, "points");
  const seriesClause = seriesKey ? ` AND series_key = '${sqlString(seriesKey)}'` : "";
  const knownClause = knownAt ? ` AND observed_at <= TIMESTAMP '${knownAt}'` : "";
  const cursorClause = cursor
    ? ` AND (event_time < TIMESTAMP '${cursor.time}' OR (event_time = TIMESTAMP '${cursor.time}' AND series_key > '${sqlString(cursor.key)}') OR (event_time = TIMESTAMP '${cursor.time}' AND series_key = '${sqlString(cursor.key)}' AND revision_id < '${sqlString(cursor.revision)}'))`
    : "";
  const sql = `WITH ranked AS (SELECT revision_id, series_key, event_time, value, unit, dimensions, observed_at, ROW_NUMBER() OVER (PARTITION BY series_key, event_time ORDER BY observed_at DESC, revision_id DESC) AS rn FROM open_data.points WHERE feed_id = '${sqlString(product.feedId)}' AND product_slug = '${sqlString(product.slug)}'${ingestFloor(feed, from, start)}${seriesClause}${knownClause}) SELECT revision_id, series_key, event_time, value, unit, dimensions, observed_at FROM ranked WHERE rn = 1 AND event_time >= TIMESTAMP '${from}' AND event_time < TIMESTAMP '${to}'${cursorClause} ORDER BY event_time DESC, series_key ASC, revision_id DESC LIMIT ${limit + 1}`;
  const result = await runTypedHistoryQuery(registry, ctx, sql, `series:${product.slug}`);
  const page = result.rows.slice(0, limit).map((row) => ({
    seriesKey: row.series_key,
    eventTime: isoTime(row.event_time),
    value: row.value,
    unit: row.unit,
    dimensions: lakeObject(row.dimensions) ?? {},
    observedAt: isoTime(row.observed_at),
  }));
  const last = result.rows[limit - 1];
  return json({
    data: page,
    nextCursor: result.rows.length > limit && last ? encodeHistoryCursor(String(last.event_time), String(last.series_key), String(last.revision_id)) : null,
    knownAt: knownAt ?? null,
    freshness: { updatedAt: product.updatedAt, stale: product.stale },
    coverage: coverageFor(feed, from, to, start),
    source: "lake",
  });
}

/** Every point revision ingested in [from, to): new points and corrections, newest knowledge first. */
async function seriesChangeRange(ctx: ApiContext, registry: () => RegistryStub, url: URL, product: HistoricalProduct, feed: Feed): Promise<Response> {
  const { from, to } = historyWindow(url);
  const seriesKey = optionalQuery(url, "seriesKey");
  const limit = parseInteger(url, "limit", 500, 1, MAX_HISTORY_PAGE);
  const cursor = historyCursor(url);
  const start = await lakeStart(ctx, "points");
  const seriesClause = seriesKey ? ` AND series_key = '${sqlString(seriesKey)}'` : "";
  const cursorClause = cursor
    ? ` AND (observed_at < TIMESTAMP '${cursor.time}' OR (observed_at = TIMESTAMP '${cursor.time}' AND series_key > '${sqlString(cursor.key)}') OR (observed_at = TIMESTAMP '${cursor.time}' AND series_key = '${sqlString(cursor.key)}' AND revision_id < '${sqlString(cursor.revision)}'))`
    : "";
  // A revision is observed no later than it is ingested, so partitions before `from` hold none of the window.
  const sql = `WITH unique_revisions AS (SELECT revision_id, series_key, event_time, value, unit, dimensions, observed_at, ROW_NUMBER() OVER (PARTITION BY revision_id ORDER BY observed_at DESC) AS duplicate_rank FROM open_data.points WHERE feed_id = '${sqlString(product.feedId)}' AND product_slug = '${sqlString(product.slug)}' AND __ingest_ts >= TIMESTAMP '${latest(from, start)}'${seriesClause}) SELECT revision_id, series_key, event_time, value, unit, dimensions, observed_at FROM unique_revisions WHERE duplicate_rank = 1 AND observed_at >= TIMESTAMP '${from}' AND observed_at < TIMESTAMP '${to}'${cursorClause} ORDER BY observed_at DESC, series_key ASC, revision_id DESC LIMIT ${limit + 1}`;
  const result = await runTypedHistoryQuery(registry, ctx, sql, `series-changes:${product.slug}`);
  const page = result.rows.slice(0, limit).map((row) => ({
    revisionId: row.revision_id,
    seriesKey: row.series_key,
    eventTime: isoTime(row.event_time),
    value: row.value,
    unit: row.unit,
    dimensions: lakeObject(row.dimensions) ?? {},
    observedAt: isoTime(row.observed_at),
  }));
  const last = result.rows[limit - 1];
  return json({
    data: page,
    nextCursor: result.rows.length > limit && last ? encodeHistoryCursor(String(last.observed_at), String(last.series_key), String(last.revision_id)) : null,
    freshness: { updatedAt: product.updatedAt, stale: product.stale },
    coverage: coverageFor(feed, from, to, start),
    source: "lake",
  });
}

/** The product a history endpoint serves, as the public catalog shows it. */
interface HistoricalProduct {
  slug: string;
  feedId: string;
  role: string;
  updatedAt: string;
  stale: boolean;
}

/** Both ends of a history window, as ISO 8601 UTC times. */
interface HistoryWindow {
  from: string;
  to: string;
}

/** A validated history window: both ends given, ordered, at most 366 days apart. */
function historyWindow(url: URL): HistoryWindow {
  const from = requiredDate(url, "from");
  const to = requiredDate(url, "to");
  if (from >= to) throw new RequestError("from must be before to", 400);
  if (Date.parse(to) - Date.parse(from) > MAX_HISTORY_WINDOW_MS)
    throw new RequestError("A history window cannot exceed 366 days; page through longer spans one window at a time", 400);
  return { from, to };
}

/**
 * For feeds whose facts are observed after they happen (events, observations),
 * a revision about an event in [from, to) cannot have been ingested before
 * `from`. No revision at all was ingested before the lake began. Either bound
 * lets the day-partitioned lake skip older files.
 */
function ingestFloor(feed: Feed, from: string, start: string | undefined): string {
  const eventLike = feed.semantics.domainSubject === "event" || feed.semantics.domainSubject === "observation";
  const bound = eventLike ? latest(from, start) : start;
  return bound ? ` AND __ingest_ts >= TIMESTAMP '${bound}'` : "";
}

function latest(time: string, other: string | undefined): string {
  return other !== undefined && other > time ? other : time;
}

/** The first ingest day each lake table holds, per isolate, refreshed every six hours. */
const lakeStarts = new Map<"records" | "points", { value: string | undefined; until: number }>();

/**
 * When history begins: the first ingest day of a lake table. A window that
 * starts earlier is clamped to it, so no query scans days before the lake
 * existed. Unavailable, it clamps nothing and is retried in five minutes.
 */
async function lakeStart(ctx: ApiContext, table: "records" | "points"): Promise<string | undefined> {
  const cached = lakeStarts.get(table);
  if (cached && cached.until > Date.now()) return cached.value;
  let value: string | undefined;
  let lifetime = 6 * 3_600_000;
  try {
    const result = await runLakeQuery(ctx.env, `SELECT MIN(__ingest_ts) AS first_ingest FROM open_data.${table} LIMIT 1`, `lake-start:${table}`, ctx.lakeQueryFetch);
    const first = result.rows[0]?.first_ingest;
    const time = isJsonString(first) ? Date.parse(first) : Number.NaN;
    if (!Number.isNaN(time)) value = `${new Date(time).toISOString().slice(0, 10)}T00:00:00.000Z`;
  } catch (error) {
    console.warn(JSON.stringify({ event: "lake_start_unavailable", table, error: error instanceof Error ? error.message : String(error) }));
    lifetime = 5 * 60_000;
  }
  lakeStarts.set(table, { value, until: Date.now() + lifetime });
  return value;
}

async function runTypedHistoryQuery(registry: () => RegistryStub, ctx: ApiContext, sql: string, label: string) {
  return await withHistorySlot(registry, () => runLakeQuery(ctx.env, sql, label, ctx.lakeQueryFetch));
}

/** A history view of a product whose policy does not serve history, or of the wrong role, does not exist. */
function requireHistory(product: ProductDetail, role?: "event-log" | "time-series"): void {
  if (!product.exposeHistory || (role !== undefined && product.role !== role)) throw new NotFoundError("Historical product was not found");
}

/** The feed behind a product's history: its semantics bound the lake scan, its backfill states coverage. */
async function historicalFeed(registry: () => RegistryStub, product: ProductDetail, role?: "event-log" | "time-series"): Promise<Feed> {
  requireHistory(product, role);
  const feed = await callRegistry(registry, (coordinator) => coordinator.getFeed(product.feedId));
  if (!feed) throw new NotFoundError("Historical product was not found");
  return feed;
}

/** Tell the edge how often this product changes, so it can keep one that changes rarely for longer. */
function withCadence(response: Response, product: ProductDetail): Response {
  response.headers.set(CADENCE_HEADER, String(product.cadenceSeconds));
  return response;
}

function coverageFor(feed: Feed, from: string, to: string, lakeStartsAt: string | undefined) {
  const backfill = feed.backfill;
  const coveredFrom = backfill ? Object.values(backfill.floors).sort()[0] : undefined;
  return {
    requested: { from, to },
    lakeStartsAt: lakeStartsAt ?? null,
    coveredFrom: coveredFrom ?? null,
    complete: backfill?.status === "complete" && Boolean(coveredFrom && coveredFrom <= from),
    reason: !backfill ? "No completed historical walk is recorded" : backfill.status === "complete" ? null : `Historical walk is ${backfill.status}`,
  };
}

/* ---------- Visibility ---------- */

async function requireFeed(reg: RegistryStub, feedId: string): Promise<Feed> {
  const feed = await reg.getFeed(feedId);
  if (!feed) throw new NotFoundError("Feed was not found");
  return feed;
}

/** The Registry's product index, as the public API reads it. */
function publicCatalog(reg: RegistryStub): ProductCatalog {
  return { listProducts: async () => reg.listProducts(), getProduct: async (slug) => reg.getProduct(slug) };
}

/** Standards a publisher can share data through; anything else is the publisher's own API. */
const STANDARD_FORMATS = new Set(["arcgis", "ckan", "gbfs", "gtfs", "opendatasoft", "udata"]);

/**
 * A feed as the API shows it: where the data comes from, how often it is read, and how its
 * collection is going. The runner's scope and checkpoint, the policy, the library, the lake
 * backlog and raw errors stay inside the platform; /api/outages says when a source failed.
 */
function publicFeed(feed: Feed, cadenceSeconds: number | undefined) {
  const {
    feedEpoch: _epoch,
    resolved: _resolved,
    checkpoint: _checkpoint,
    policyId: _policy,
    library: _library,
    semantics: _semantics,
    config,
    cooldownUntil: _cooldown,
    lastError: _error,
    historyBacklog: _backlog,
    backfill: _backfill,
    publisher,
    ...publicValue
  } = feed;
  const source = config.source ?? "";
  return { ...publicValue, publisher: publisherRef(publisher), format: STANDARD_FORMATS.has(source) ? source : "own-api", cadenceSeconds: cadenceSeconds ?? null };
}

/* ---------- Record filters ---------- */

/** `where=field:value` (repeatable) and `bbox=west,south,east,north`, if given. */
function rowFilters(url: URL): RowFilters | undefined {
  const where = url.searchParams.getAll("where").map(parseWhere);
  const bbox = optionalQuery(url, "bbox");
  if (where.length === 0 && !bbox) return undefined;
  if (where.length > MAX_FILTERS) throw new RequestError(`At most ${MAX_FILTERS} where filters are allowed`, 400);
  const filters: RowFilters = {};
  if (where.length > 0) filters.where = where;
  if (bbox) filters.bbox = parseBbox(bbox);
  return filters;
}

function parseWhere(value: string): FieldFilter {
  const separator = value.indexOf(":");
  const field = separator > 0 ? value.slice(0, separator).trim() : "";
  const expected = separator > 0 ? value.slice(separator + 1) : "";
  if (!field || field.length > 128 || expected.length > 200) throw new RequestError("where must be field:value", 400);
  return { field, value: expected };
}

function parseBbox(value: string): BoundingBox {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) throw new RequestError("bbox must be minLon,minLat,maxLon,maxLat in degrees", 400);
  const [west = 0, south = 0, east = 0, north = 0] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new RequestError("bbox must be minLon,minLat,maxLon,maxLat in degrees, with min below max", 400);
  }
  return { west, south, east, north };
}

/* ---------- Views ---------- */

/** A run as the API shows it; the policy version and the lake bookkeeping stay inside the platform. */
function publicAcquisition(acquisition: Acquisition) {
  const { policyVersion: _policy, historyRows: _history, ...publicValue } = acquisition;
  return publicValue;
}

/* ---------- Parameters ---------- */

function requiredDate(url: URL, name: string): string {
  const value = optionalQuery(url, name);
  if (!value || Number.isNaN(Date.parse(value))) throw new RequestError(`${name} must be an ISO 8601 date-time`, 400);
  return new Date(value).toISOString();
}

/** An optional ISO 8601 time parameter, normalized. */
function optionalTime(url: URL, name: string): string | undefined {
  const value = optionalQuery(url, name);
  if (value === undefined) return undefined;
  if (Number.isNaN(Date.parse(value))) throw new RequestError(`${name} must be an ISO 8601 date-time`, 400);
  return new Date(value).toISOString();
}

function encodeHistoryCursor(time: string, key: string, revision: string): string {
  return encodeCursor(JSON.stringify({ time: new Date(time).toISOString(), key, revision }));
}

function historyCursor(url: URL): { time: string; key: string; revision: string } | undefined {
  const encoded = optionalQuery(url, "cursor");
  if (!encoded) return undefined;
  try {
    const value = asObject(parseJson(decodeCursor(encoded)));
    const time = asString(value?.time);
    const key = asString(value?.key);
    const revision = asString(value?.revision);
    if (!time || Number.isNaN(Date.parse(time)) || key === undefined || revision === undefined) throw new Error("incomplete cursor");
    return { time: new Date(time).toISOString(), key, revision };
  } catch {
    throw new RequestError("cursor is invalid", 400);
  }
}

/** A lake JSON field, whether R2 SQL returned JSON text or an object. */
function lakeObject(value: JsonValue | undefined): JsonObject | null {
  if (isJsonString(value)) {
    try {
      return asObject(parseJson(value)) ?? null;
    } catch {
      return null;
    }
  }
  return asObject(value) ?? null;
}

const SOURCE_SEQUENCE_FIELD = "__openDataSourceSequence";

/** One row's payload, stripping the kernel-owned history metadata envelope. */
function lakePayload(payload: JsonValue | undefined): JsonObject {
  const value = lakeObject(payload) ?? {};
  const { [SOURCE_SEQUENCE_FIELD]: _sequence, ...source } = value;
  return source;
}

function lakeSourceSequence(payload: JsonValue | undefined): string | null {
  return asString(lakeObject(payload)?.[SOURCE_SEQUENCE_FIELD]) ?? null;
}

function encodeCursor(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeCursor(value: string): string {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(escape(atob(normalized + padding)));
  } catch {
    throw new RequestError("cursor is invalid", 400);
  }
}

function optionalQuery(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

function parseInteger(url: URL, name: string, defaultValue: number, minimum: number, maximum: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return defaultValue;
  if (!/^\d+$/.test(raw)) throw new RequestError(`${name} must be an integer`, 400);
  const value = Number(raw);
  if (value < minimum || value > maximum) throw new RequestError(`${name} must be between ${minimum} and ${maximum}`, 400);
  return value;
}

/* ---------- Responses ---------- */

function json<T>(value: T, status = 200): Response {
  return Response.json(value, { status, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
}

/** An `application/problem+json` answer. Details never carry internal error text. */
export function problem(status: number, title: string, detail: string, headers: HeaderMap = {}): Response {
  return Response.json(
    { type: "about:blank", title, status, detail },
    { status, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Type": "application/problem+json", ...headers } },
  );
}

/** A failed history query told as the caller can act on it; the store's own message stays in the log. */
function historyFailure(failure: QueryError["failure"]) {
  if (failure === "timeout") return { status: 504, title: "History query timed out", detail: "The history store took too long to answer. Ask for a shorter window." };
  if (failure === "refused")
    return {
      status: 500,
      title: "History query failed",
      detail: "open-data.pt built a history query that its own safety check refused. That is a bug on our side, not in your request.",
    };
  if (failure === "unreadable") return { status: 502, title: "History query failed", detail: "The history store answered with something open-data.pt could not read." };
  return { status: 502, title: "History query failed", detail: "The history store could not run this query. Try again, or ask for a shorter window." };
}

/** Quote a value for a single-quoted SQL literal: only what the lake query surface allows. */
function sqlString(value: string): string {
  if (value.length > 200 || hasControlCharacter(value)) throw new RequestError("Invalid value", 400);
  return value.replaceAll("'", "''");
}

/** Control characters have no place in a lake query literal. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) < 0x20) return true;
  }
  return false;
}

/** The lake returns timestamps with microseconds; pages compare ISO strings, so keep one shape. */
function isoTime(value: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonString(value)) return value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}
