import { DurableObject } from "cloudflare:workers";
import { asObject, parseJson, requireString } from "@open-data-pt/contract";
import type { ApiContext } from "../../apps/kernel/src/http";
import KernelWorker from "../../apps/kernel/src/index";
export { Registry, FeedRunner, CollectionWorkflow } from "../../apps/kernel/src/index";

interface HistoryTestEnv extends Env {
  HISTORY_FIXTURE: DurableObjectNamespace<HistoryFixture>;
}

/** Run the real HTTP handler and R2 SQL client, replacing only provider transport. */
export default class ProductHistoryTestWorker extends KernelWorker {
  private readonly historyFixture: DurableObjectNamespace<HistoryFixture>;
  constructor(ctx: ExecutionContext, env: HistoryTestEnv) {
    super(ctx, { ...env, CATALOG_TOKEN: "test-only", CLOUDFLARE_ACCOUNT_ID: "test-account", LAKE_BUCKET: "test-history" });
    this.historyFixture = env.HISTORY_FIXTURE;
  }
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/test/queries") return this.historyFixture.getByName("history").fetch("https://fixture/queries");
    return super.fetch(request);
  }
  protected override apiContext(): ApiContext {
    return { ...super.apiContext(), lakeQueryFetch: async (input, init) => {
      if (String(input) !== "https://api.sql.cloudflarestorage.com/api/v1/accounts/test-account/r2-sql/query/test-history") throw new Error("Unexpected provider URL");
      return this.historyFixture.getByName("history").fetch(new Request("https://fixture/query", init));
    } };
  }
}

/** Real SQLite executes the emitted window queries, including the ingest-day partition bound. */
export class HistoryFixture extends DurableObject {
  constructor(ctx: DurableObjectState, env: HistoryTestEnv) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS records (
      feed_id TEXT, product_slug TEXT, revision_id TEXT, entity_key TEXT, operation TEXT,
      event_time TEXT, valid_from TEXT, valid_to TEXT, source_published_at TEXT, source_sequence TEXT, observed_at TEXT, ingested_at TEXT, payload TEXT, __ingest_ts TEXT)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS points (
      feed_id TEXT, product_slug TEXT, revision_id TEXT, series_key TEXT, event_time TEXT, value REAL, unit TEXT, dimensions TEXT, observed_at TEXT, __ingest_ts TEXT)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS queries (query TEXT)`);
    if (sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM records").one().count) return;
    const day = (value: number) => `2026-09-0${value}T00:00:00.000Z`;
    // Same logical keys/revision IDs across feeds expose filtering after ranking as incorrect too.
    for (const row of [
      { owner: "feed-owner's", slug: "shared-events", id: "one", time: 1, observed: 1, value: 1 },
      { owner: "feed-owner's", slug: "shared-events", id: "two", time: 2, observed: 2, value: 2 },
      { owner: "other-owner", slug: "shared-events", id: "one", time: 1, observed: 4, value: 99 },
      { owner: "other-owner", slug: "shared-events", id: "foreign", time: 3, observed: 3, value: 98 },
      { owner: "feed-owner's", slug: "another-events-product", id: "one", time: 1, observed: 5, value: 999 },
    ]) {
      sql.exec("INSERT INTO records VALUES (?, ?, ?, ?, 'upsert', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)",
        row.owner, row.slug, `rev-${row.id}`, row.id, day(row.time), day(row.observed), day(row.observed), JSON.stringify({ value: row.value, __openDataSourceSequence: `seq-${row.id}`, id: "spoof", operation: "delete", eventTime: "1900-01-01T00:00:00Z", sourcePublishedAt: "spoof", observedAt: "spoof", ingestedAt: "spoof" }), day(row.observed));
    }
    for (const row of [
      { owner: "feed-owner's", slug: "shared-series", revision: "rev-1", time: 1, observed: 1, value: 1 },
      { owner: "feed-owner's", slug: "shared-series", revision: "rev-2", time: 2, observed: 2, value: 2 },
      { owner: "other-owner", slug: "shared-series", revision: "rev-1", time: 1, observed: 4, value: 99 },
      { owner: "other-owner", slug: "shared-series", revision: "rev-3", time: 3, observed: 3, value: 98 },
      { owner: "feed-owner's", slug: "another-series-product", revision: "rev-1", time: 1, observed: 5, value: 999 },
      // One point, published on day 1 and corrected on day 3.
      { owner: "feed-owner's", slug: "revised-series", revision: "rev-a", time: 1, observed: 1, value: 1 },
      { owner: "feed-owner's", slug: "revised-series", revision: "rev-b", time: 1, observed: 3, value: 10 },
    ]) {
      sql.exec("INSERT INTO points VALUES (?, ?, ?, 'load', ?, ?, 'MW', '{}', ?, ?)",
        row.owner, row.slug, row.revision, day(row.time), row.value, day(row.observed), day(row.observed));
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    if (request.method === "GET") return Response.json(sql.exec("SELECT query FROM queries").toArray());
    const input = asObject(parseJson(await request.text()));
    if (!input) throw new Error("Query envelope is required");
    const query = requireString(input, "query");
    sql.exec("INSERT INTO queries VALUES (?)", query);
    if (query.includes("series_key = 'provider-failure'")) return Response.json({ success: false, errors: [{ message: "fixture query failure" }], result: { metrics: { bytes_scanned: 207 } } }, { status: 500 });
    // Only dialect adaptation: SQLite has no R2 catalog namespace or typed TIMESTAMP literal.
    const sqlite = query.replaceAll("open_data.", "").replace(/TIMESTAMP ('[^']*')/g, "$1");
    const rows = sql.exec(sqlite).toArray();
    return Response.json({ success: true, result: { rows, metrics: { bytes_scanned: 100 } } });
  }
}
