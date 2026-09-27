import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import type { Feed, ProductIndexEntry } from "../src/feed-model";
import { fixtureResolved } from "./kernel-harness";
import { jsonBody } from "./support";

const server = createTestHarness({
  workers: [
    {
      config: {
        name: "product-history-test",
        main: "apps/kernel/tests/fixtures/product-history-worker.ts",
        compatibility_date: "2026-09-09",
        compatibility_flags: ["nodejs_compat"],
        r2_buckets: [{ binding: "DATA_OBJECTS", bucket_name: "test-only" }],
        durable_objects: {
          bindings: [
            { name: "Registry", class_name: "Registry" },
            { name: "FeedRunner", class_name: "FeedRunner" },
            { name: "HISTORY_FIXTURE", class_name: "HistoryFixture" },
          ],
        },
        workflows: [{ name: "open-data-pt-collections", binding: "COLLECTIONS", class_name: "CollectionWorkflow" }],
        migrations: [{ tag: "test-only", new_sqlite_classes: ["Registry", "FeedRunner", "HistoryFixture"] }],
      },
    },
  ],
});

beforeAll(async () => {
  await server.listen();
  expect((await server.fetch("/api/feeds")).status).toBe(200);
  const sql = await server.getWorker().getDurableObjectStorage("Registry", { name: "main" });
  const collection = { cadenceSeconds: 3600, timeoutSeconds: 60, maxBytes: 1024 };
  for (const [policy, history] of [
    ["public-history", { historyMode: "changes" }],
    ["no-history", { historyMode: "latest" }],
    ["left-out", { historyMode: "changes", withoutHistory: ["left-out-events"] }],
  ] as const) {
    await sql.exec("INSERT INTO policies VALUES (?, ?, 1, ?, ?, 'saved')", policy, policy, JSON.stringify({ ...collection, ...history }), "{}");
  }
  const resolved = await fixtureResolved();
  for (const [feedId, policy] of [
    ["feed-owner's", "public-history"],
    ["other-owner", "public-history"],
    ["private-owner", "no-history"],
    ["left-out-owner", "left-out"],
  ] as const) {
    const semantics = { ...resolved.semantics, domainSubject: "event" as const };
    const feed: Feed = {
      id: feedId,
      slug: feedId,
      title: feedId,
      description: "",
      library: "fixture",
      config: {},
      semantics,
      resolved: { ...resolved, semantics },
      feedEpoch: "e",
      policyId: policy,
      enabled: false,
      staleAfterSeconds: 60,
      publisher: "ine",
      licence: "cc-by-4.0",
      topics: ["economy"],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    await sql.exec("INSERT INTO feeds (id, slug, definition_json, policy_id, enabled, title) VALUES (?, ?, ?, ?, 0, ?)", feedId, feedId, JSON.stringify(feed), policy, feedId);
  }
  for (const [slug, role, feedId] of [
    ["shared-events", "event-log", "feed-owner's"],
    ["shared-series", "time-series", "feed-owner's"],
    ["revised-series", "time-series", "feed-owner's"],
    ["private-events", "event-log", "private-owner"],
    ["left-out-events", "event-log", "left-out-owner"],
    ["kept-events", "event-log", "left-out-owner"],
  ] as const) {
    const entry: ProductIndexEntry = {
      id: `prd_${slug}`,
      slug,
      feedId,
      productKey: slug,
      title: slug,
      description: "",
      role,
      kind: role === "time-series" ? "series" : "record",
      schema: { fields: [] },
      updateMode: "authoritative-snapshot",
      completeness: "complete",
      version: 1,
      status: "current",
      currentAcquisitionId: null,
      watermark: null,
      rowCount: 0,
      chunks: null,
      // Both siblings hold a change window: the left-out one's is left from before its policy left it out.
      changesKey: slug === "left-out-events" || slug === "kept-events" ? `changes/${slug}.json` : null,
      seriesKey: null,
      seriesChangesKey: null,
      updatedAt: "2026-09-05T00:00:00.000Z",
      createdAt: "2026-09-05T00:00:00.000Z",
    };
    await sql.exec("INSERT INTO products (slug, feed_id, product_key, title, entry_json) VALUES (?, ?, ?, ?, ?)", slug, feedId, slug, slug, JSON.stringify(entry));
  }
}, 60_000);
afterAll(async () => {
  await server.close();
}, 30_000);

interface HistoryPage {
  data: Array<{ value?: number; revisionId?: string; payload?: { value: number } }>;
  nextCursor: string | null;
  knownAt?: string | null;
  coverage: { lakeStartsAt: string | null };
}

/** The history queries the fixture ran. */
async function historyQueries(): Promise<string[]> {
  const queries = await jsonBody<Array<{ query: string }>>(await server.fetch("/test/queries"));
  return queries.map(({ query }) => query).filter((query) => query.includes("product_slug"));
}

const endpoints = [
  ["shared-events", "events"],
  ["shared-events", "changes/range"],
  ["shared-series", "series/range"],
  ["shared-series", "series/changes/range"],
  // A series product's revisions are points.
  ["shared-series", "changes/range"],
] as const;
const bounds = "from=2026-09-01T00:00:00Z&to=2026-09-06T00:00:00Z&limit=1";

describe("typed product history owner isolation", () => {
  it.each(endpoints)("scopes %s/%s to the selected Registry owner before ranking and pagination", async (slug, endpoint) => {
    const path = `/api/products/${slug}/${endpoint}?${bounds}`;
    const firstResponse = await server.fetch(path);
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(200);
    const first = await jsonBody<HistoryPage>(firstResponse);
    expect(first.data.map((row) => row.payload?.value ?? row.value)).toEqual([2]);
    expect(first.nextCursor).toBeTypeOf("string");
    const secondResponse = await server.fetch(`${path}&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(secondResponse.status, await secondResponse.clone().text()).toBe(200);
    const second = await jsonBody<HistoryPage>(secondResponse);
    expect(second.data.map((row) => row.payload?.value ?? row.value)).toEqual([1]);
    expect(second.nextCursor).toBeNull();
    for (const query of (await historyQueries()).slice(-2)) {
      expect(query).toContain("WHERE feed_id = 'feed-owner''s' AND product_slug = '");
      expect(query).toContain(`product_slug = '${slug}'`);
      // Event and observation feeds let the lake skip ingest-day partitions: ten days before the window for what a
      // source may publish ahead, and the window itself for changes, since knowledge time never precedes ingestion.
      expect(query).toContain(`__ingest_ts >= TIMESTAMP '${endpoint.includes("changes") ? "2026-09-01" : "2026-08-22"}T00:00:00.000Z'`);
    }
  });

  it("refuses parameters a route does not accept, so a caller cannot pick another owner", async () => {
    const response = await server.fetch(`/api/products/shared-events/events?${bounds}&feedId=other-owner`);
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toContain("feedId");
    expect((await server.fetch(`/api/products/shared-events/events?${bounds}&limit=2`)).status).toBe(400);
  });

  /**
   * Day-ahead prices and load forecasts are ingested before the hours they are
   * about, so the floor opens ten days before the window rather than at it. The
   * window here starts well after the lake's first day, which would otherwise
   * be the later bound and hide the subtraction.
   */
  it.each([
    ["shared-events", "events"],
    ["shared-series", "series/range"],
  ])("lets %s/%s read what a source published up to ten days before the window", async (slug, endpoint) => {
    const response = await server.fetch(`/api/products/${slug}/${endpoint}?from=2026-09-20T00:00:00Z&to=2026-09-25T00:00:00Z&limit=1`);
    expect(response.status, await response.clone().text()).toBe(200);
    const query = (await historyQueries()).at(-1) ?? "";
    expect(query).toContain("__ingest_ts >= TIMESTAMP '2026-09-10T00:00:00.000Z'");
    // Only the ingest floor moves: the window itself still holds the event times asked for.
    expect(query).toContain("event_time >= TIMESTAMP '2026-09-20T00:00:00.000Z' AND event_time < TIMESTAMP '2026-09-25T00:00:00.000Z'");
  });

  it("keeps history authorization and missing-product checks ahead of the query", async () => {
    const before = await historyQueries();
    expect((await server.fetch(`/api/products/private-events/events?${bounds}`)).status).toBe(404);
    expect((await server.fetch(`/api/products/left-out-events/events?${bounds}`)).status).toBe(404);
    expect((await server.fetch(`/api/products/left-out-events/changes/range?${bounds}`)).status).toBe(404);
    expect((await server.fetch(`/api/products/absent-legacy-slug/series/range?${bounds}`)).status).toBe(404);
    expect((await server.fetch(`/api/products/shared-events/series/changes/range?${bounds}`)).status).toBe(404);
    expect(await historyQueries()).toEqual(before);
  });

  it("decides history per product: one its policy leaves out has none, a sibling on the same feed keeps it", async () => {
    const leftOut = await jsonBody<{ exposeHistory: boolean; historyMode: string; hasChanges: boolean }>(await server.fetch("/api/products/left-out-events"));
    expect(leftOut).toMatchObject({ exposeHistory: false, historyMode: "latest", hasChanges: false });
    const kept = await jsonBody<{ exposeHistory: boolean; historyMode: string; hasChanges: boolean }>(await server.fetch("/api/products/kept-events"));
    expect(kept).toMatchObject({ exposeHistory: true, historyMode: "changes", hasChanges: true });
  });
});

describe("series as known at any moment", () => {
  const window = "from=2026-09-01T00:00:00Z&to=2026-09-06T00:00:00Z";

  it("reads each point's latest revision, or the one known at knownAt", async () => {
    const now = await jsonBody<HistoryPage>(await server.fetch(`/api/products/revised-series/series/range?${window}`));
    expect(now.data.map((row) => row.value)).toEqual([10]);
    const then = await jsonBody<HistoryPage>(await server.fetch(`/api/products/revised-series/series/range?${window}&knownAt=2026-09-02T00:00:00Z`));
    expect(then.data.map((row) => row.value)).toEqual([1]);
    expect(then.knownAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("lists every point revision ingested in the window, corrections included", async () => {
    const page = await jsonBody<HistoryPage>(await server.fetch(`/api/products/revised-series/series/changes/range?${window}`));
    expect(page.data.map((row) => [row.revisionId, row.value])).toEqual([
      ["rev-b", 10],
      ["rev-a", 1],
    ]);
    expect(page.coverage.lakeStartsAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("reads a window that starts before the lake without first asking the lake where it starts", async () => {
    const response = await server.fetch("/api/products/revised-series/series/changes/range?from=2026-01-01T00:00:00Z&to=2026-09-06T00:00:00Z");
    expect(response.status).toBe(200);
    expect((await historyQueries()).at(-1)).toContain("__ingest_ts >= TIMESTAMP '2026-01-01T00:00:00.000Z'");
    const everything = await jsonBody<Array<{ query: string }>>(await server.fetch("/test/queries"));
    expect(everything.some(({ query }) => query.includes("MIN(__ingest_ts)"))).toBe(false);
  });

  // The site's chart asks for the largest page; the query reads one row more to know whether another page follows.
  it.each(["series/range", "series/changes/range"])("serves %s's largest page, 1000 points, with the row that says another follows", async (endpoint) => {
    const response = await server.fetch(`/api/products/revised-series/${endpoint}?${window}&limit=1000`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await historyQueries()).at(-1)).toMatch(/ LIMIT 1001$/);
  });
});

describe("series summaries", () => {
  const window = "from=2026-09-01T00:00:00Z&to=2026-09-06T00:00:00Z";

  it("answers a window from summary files, empty until the first day is summarised", async () => {
    const response = await server.fetch(`/api/products/revised-series/series/summary?${window}&seriesKey=a&seriesKey=b`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({
      resolution: "hour",
      timeZone: "Europe/Lisbon",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-06T00:00:00.000Z",
      coverage: { firstDay: null, through: null, until: null },
      series: [],
    });
  });

  it("404s a month or year without a file and a product without public history, and refuses what it cannot answer", async () => {
    expect((await server.fetch("/api/products/revised-series/series/summary/2026-09")).status).toBe(404);
    expect((await server.fetch("/api/products/revised-series/series/summary/2026")).status).toBe(404);
    expect((await server.fetch(`/api/products/private-events/series/summary?${window}`)).status).toBe(404);
    expect((await server.fetch(`/api/products/revised-series/series/summary?${window}&resolution=week`)).status).toBe(400);
    expect((await server.fetch(`/api/products/revised-series/series/summary?${window}&limit=5`)).status).toBe(400);
    // A day no calendar has is refused, not rolled over into March.
    expect((await server.fetch("/api/products/revised-series/series/summary?from=2026-02-30T00:00:00Z&to=2026-03-05T00:00:00Z")).status).toBe(400);
    expect((await server.fetch("/api/products/revised-series/series?from=2026-02-30T00:00:00Z")).status).toBe(400);
    expect((await server.fetch("/api/acquisitions?day=2026-02-30")).status).toBe(400);
    expect((await server.fetch("/api/products/revised-series/series?from=2026-02-28T23:00:00-01:00")).status).toBe(200);
  });
});

it("keeps flattened nonconflicting event payload fields but authoritative metadata wins collisions", async () => {
  const response = await server.fetch(`/api/products/shared-events/events?${bounds}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: [
      {
        value: 2,
        id: "two",
        operation: "upsert",
        eventTime: "2026-09-02T00:00:00.000Z",
        sourcePublishedAt: null,
        sourceSequence: "seq-two",
        observedAt: "2026-09-02T00:00:00.000Z",
        ingestedAt: "2026-09-02T00:00:00.000Z",
      },
    ],
  });
});

it("reports a provider failure as a bad gateway without leaking the provider's message", async () => {
  const response = await server.fetch(`/api/products/shared-series/series/range?${bounds}&seriesKey=provider-failure`);
  expect(response.status).toBe(502);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("x-request-id")).toBeTruthy();
  const body = await response.text();
  expect(body).not.toContain("fixture query failure");
  expect(body).toContain("The history store could not run this query");
});

describe("a read-only, public-only API", () => {
  it("answers only GET, HEAD and OPTIONS", async () => {
    for (const [method, path] of [
      ["POST", "/api/feeds"],
      ["POST", "/api/bootstrap"],
      ["DELETE", "/api/feeds/feed-owner's/backfill"],
      ["PUT", "/api/products/shared-events"],
    ] as const) {
      const response = await server.fetch(path, { method });
      expect(response.status, `${method} ${path}`).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
    const preflight = await server.fetch("/api/products", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("Content-Type");
    const head = await server.fetch("/api/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await server.fetch("/api/config")).status).toBe(404);
  });

  it("answers for what it knows and 404s for what it does not", async () => {
    const products = await jsonBody<{ data: Array<{ slug: string }> }>(await server.fetch("/api/products"));
    expect(products.data.map((product) => product.slug)).toContain("shared-events");
    expect((await server.fetch("/api/feeds/feed-owner's")).status).toBe(200);
    expect((await server.fetch("/api/feeds/no-such-feed")).status).toBe(404);
    expect((await server.fetch("/api/products/no-such-product")).status).toBe(404);
  });
});
