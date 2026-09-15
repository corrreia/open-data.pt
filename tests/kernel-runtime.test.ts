import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import type { Acquisition, Feed } from "../apps/kernel/src/feed-model";
import { openApiDocument } from "../apps/kernel/src/openapi";
import { jsonBody } from "./support";

// Isolated local Workers: the real kernel, a real Workflow executor, Durable Objects and R2; no production config and no operator.
const server = createTestHarness({ workers: [{ config: {
  name: "kernel-runtime-test",
  main: "tests/fixtures/kernel-runtime-worker.ts",
  compatibility_date: "2026-09-09",
  compatibility_flags: ["nodejs_compat"],
  r2_buckets: [{ binding: "DATA_OBJECTS", bucket_name: "test-only-data" }],
  durable_objects: { bindings: [{ name: "Registry", class_name: "Registry" }, { name: "FeedRunner", class_name: "FeedRunner" }] },
  workflows: [{ name: "open-data-pt-collections", binding: "COLLECTIONS", class_name: "CollectionWorkflow" }],
  services: [{ binding: "GATEKEEPER_FIXTURE", service: "kernel-runtime-test", entrypoint: "FixtureGatekeeper" }],
  migrations: [{ tag: "test-only", new_sqlite_classes: ["Registry", "FeedRunner"] }],
} }] });

const FINAL = ["succeeded", "unchanged", "failed"];
let feedId = "";

async function waitFor<T>(probe: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const found = await probe();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** What the fixture source returns next, or what its Gatekeeper lists for the example. */
type FixtureWrite = { path: "/test/source"; rows: Array<{ key: string; name: string }>; deny?: boolean } | { path: "/test/example"; title: string };

async function put({ path, ...body }: FixtureWrite): Promise<void> {
  expect((await server.fetch(path, { method: "PUT", body: JSON.stringify(body) })).status).toBe(200);
}

async function source(rows: Array<{ key: string; name: string }>, deny = false): Promise<void> {
  await put(deny ? { path: "/test/source", deny: true, rows } : { path: "/test/source", rows });
}

/** Change what the fixture Gatekeeper lists for its example and let the Registry sync it: a changed definition is due at once. */
async function renameExample(title: string): Promise<void> {
  await put({ path: "/test/example", title });
  const synced = await server.fetch("/test/sync", { method: "POST" });
  expect(synced.status, await synced.clone().text()).toBe(200);
}

async function feeds(): Promise<Feed[]> {
  return (await jsonBody<{ data: Feed[] }>(await server.fetch("/test/feeds"))).data;
}

async function runnerFeed(): Promise<Feed | null> {
  return (await jsonBody<{ data: Feed | null }>(await server.fetch(`/test/feeds/${feedId}`))).data;
}

async function acquisitions(): Promise<Acquisition[]> {
  return (await jsonBody<{ data: Acquisition[] }>(await server.fetch(`/test/feeds/${feedId}/acquisitions`))).data;
}

/** Wait until an acquisition `pick` accepts reaches a final status. */
async function settled(pick: (item: Acquisition) => boolean): Promise<Acquisition> {
  const started = Date.now();
  const found = await waitFor(async () => (await acquisitions()).find((item) => pick(item) && FINAL.includes(item.status)), "an acquisition to finish");
  console.log(JSON.stringify({ acquisition: found.id, status: found.status, seconds: (Date.now() - started) / 1000 }));
  return found;
}

async function knownIds(): Promise<Set<string>> {
  return new Set((await acquisitions()).map((item) => item.id));
}

async function records(): Promise<Array<{ id: string; name: string }>> {
  // The Registry hands out the chunk list with the product; the API itself never reads a manifest object.
  const product = (await jsonBody<{ data: { chunks: unknown[] | null } | null }>(await server.fetch("/test/products/fixture-things"))).data;
  expect(product?.chunks?.length).toBeGreaterThan(0);
  // Current reads are edge-cached for 15 seconds; the test route reads through the API without the cache.
  const response = await server.fetch("/test/api/products/fixture-things/records?limit=500");
  expect(response.status, await response.clone().text()).toBe(200);
  return (await jsonBody<{ data: Array<{ id: string; name: string }> }>(response)).data;
}

beforeAll(async () => {
  await server.listen();
  await source([{ key: "a", name: "Alpha" }, { key: "b", name: "Beta" }, { key: "c", name: "Gamma" }]);
  // Nobody bootstraps: the first request wakes the Registry, whose first alarm installs every example.
  feedId = await waitFor(async () => (await feeds()).find((feed) => feed.slug === "fixture-things")?.id, "the example to be installed");
}, 90_000);
afterAll(async () => { await server.close(); }, 30_000);

describe("a kernel nobody operates", () => {
  it("collects an installed example by itself, then follows example updates under the same feed ID", async () => {
    expect(feedId).toMatch(/^feed_[0-9a-f]+$/);
    expect(await settled(() => true)).toMatchObject({ trigger: "scheduled", status: "succeeded" });
    expect((await records()).map((row) => row.id)).toEqual(["a", "b", "c"]);

    await source([{ key: "a", name: "Alpha" }, { key: "b", name: "Beta 2" }, { key: "c", name: "Gamma" }]);
    let seen = await knownIds();
    await renameExample("Fixture things, renamed");
    expect(await settled((item) => !seen.has(item.id))).toMatchObject({ status: "succeeded", revisions: 1 });
    expect((await feeds()).filter((feed) => feed.slug === "fixture-things")).toMatchObject([{ id: feedId, title: "Fixture things, renamed" }]);
    expect((await records()).find((row) => row.id === "b")?.name).toBe("Beta 2");
    const changesResponse = await server.fetch("/api/products/fixture-things/changes");
    // The fixture runs hourly, so the edge keeps its current data for five minutes; the cadence header stays internal.
    expect(changesResponse.headers.get("cache-control")).toContain("max-age=300");
    expect(changesResponse.headers.get("x-open-data-cadence")).toBeNull();
    const changes = await jsonBody<{ data: Array<{ entityKey: string; operation: string }> }>(changesResponse);
    expect(changes.data[0]).toMatchObject({ entityKey: "b", operation: "upsert" });

    seen = await knownIds();
    await renameExample("Fixture things, again");
    expect((await settled((item) => !seen.has(item.id))).status).toBe("unchanged");
    const geojson = await jsonBody<{ numberReturned: number }>(await server.fetch("/api/products/fixture-things.geojson"));
    expect(geojson.numberReturned).toBe(3);

    // A feed says where its data comes from and how often it is read, not how the platform runs it.
    const listed = await jsonBody<{ data: Array<{ slug: string; format: string; cadenceSeconds: number | null }> }>(await server.fetch("/api/feeds"));
    const fixtureFeed = listed.data.find((feed) => feed.slug === "fixture-things");
    expect(fixtureFeed).toMatchObject({ cadenceSeconds: 3600 });
    for (const internal of ["policyId", "gatekeeperKind", "config", "semantics", "lastError", "cooldownUntil"]) expect(fixtureFeed).not.toHaveProperty(internal);
    const today = new Date().toISOString().slice(0, 10);
    const day = await jsonBody<{ day: string; data: Array<{ feedId: string }> }>(await server.fetch(`/api/acquisitions?day=${today}&feedId=${feedId}`));
    expect(day.day).toBe(today);
    expect(day.data.length).toBeGreaterThan(0);
    expect(day.data[0]).not.toHaveProperty("policyVersion");
    // The OpenAPI document names every field a product, feed and run carries, so the reference and the MCP search tool stay true.
    const schemas = openApiDocument("https://open-data.pt").components.schemas;
    const product = await jsonBody<{ slug: string }>(await server.fetch("/api/products/fixture-things"));
    expect(Object.keys(product).filter((key) => !(key in schemas.Product.properties))).toEqual([]);
    expect(Object.keys(fixtureFeed ?? {}).filter((key) => !(key in schemas.Feed.properties))).toEqual([]);
    expect(Object.keys(day.data[0] ?? {}).filter((key) => !(key in schemas.Acquisition.properties))).toEqual([]);
    expect((await server.fetch("/api/usage")).status).toBe(404);
  }, 180_000);

  it("cools a permanent source failure down, and a changed definition retries the same acquisition at once", async () => {
    await source([], true);
    const seen = await knownIds();
    await renameExample("Fixture things, refused");
    const failed = await settled((item) => !seen.has(item.id));
    expect(failed.status).toBe("failed");
    const cooling = await waitFor(async () => {
      const feed = await runnerFeed();
      return feed?.cooldownUntil ? feed : undefined;
    }, "the cooldown");
    expect(Date.parse(cooling.cooldownUntil!) - Date.now()).toBeGreaterThan(5 * 3_600_000);
    expect(cooling.lastError).toMatch(/Retrying automatically after/);

    await source([{ key: "a", name: "Alpha" }]);
    await renameExample("Fixture things, repaired");
    expect((await settled((item) => item.id === failed.id && item.status !== "failed")).status).toBe("succeeded");
    expect((await runnerFeed())?.cooldownUntil).toBeUndefined();
    expect((await records()).map((row) => row.id)).toEqual(["a"]);
  }, 180_000);
});
