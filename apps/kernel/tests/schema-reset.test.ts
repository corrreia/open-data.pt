import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ObjectStore } from "#/serving/object-store";
import { drainOutbox } from "#/collection/engine";
import { PipelinesLake } from "#/history/lake";
import { RegistryStore, REGISTRY_SCHEMA_BASELINE, REGISTRY_SCHEMA_VERSION } from "#/registry/store";
import { RunnerCore, RUNNER_SCHEMA_BASELINE, RUNNER_SCHEMA_VERSION } from "#/runner/core";
import type { Feed, ProductIndexEntry } from "#/registry/feed-model";
import { dropAllTables, userTables } from "#/sqlite-reset";
import { fixtureResolved, MemorySnapshots } from "#/tests/kernel-harness";
import { sqliteStorage } from "#/tests/sqlite-storage";

function transaction(database: DatabaseSync) {
  return <T>(body: () => T): T => {
    database.exec("BEGIN");
    try {
      const value = body();
      database.exec("COMMIT");
      return value;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
}

/** A feed's runner on this database, with nothing behind it that migrating reaches. */
function runner(database: DatabaseSync): RunnerCore {
  return new RunnerCore(sqliteStorage(database), transaction(database), {
    objects: new ObjectStore(new MemorySnapshots()),
    publish: async (publication) => ({
      known: true,
      backfillPeers: 1,
      acceptedPublicationId: publication.id,
      acceptedThrough: publication.number,
      selectedAt: "1970-01-01T00:00:00.000Z",
    }),
    claim: async () => undefined,
    lakeAvailable: true,
    now: () => 0,
  });
}

async function feed(id = "feed_1"): Promise<Feed> {
  const resolved = await fixtureResolved();
  return {
    id,
    slug: id,
    title: "Things",
    description: "Fixture",
    library: "fixture",
    format: "own-api",
    resourceKey: resolved.resourceKey,
    configHash: resolved.configHash,
    eventTimed: false,
    policy: { cadenceSeconds: 60, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
    feedEpoch: "epoch-1",
    enabled: true,
    staleAfterSeconds: 60,
    publisher: "ine",
    licence: "cc-by-4.0",
    topics: ["economy"],
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}

function entry(owner = "feed_1"): ProductIndexEntry {
  return {
    id: "prd_things",
    slug: "things",
    feedId: owner,
    productKey: "things",
    title: "Things",
    description: "Fixture",
    role: "reference",
    kind: "record",
    schema: { fields: [] },
    updateMode: "authoritative-snapshot",
    completeness: "complete",
    version: 1,
    status: "current",
    currentAcquisitionId: "acq_1",
    watermark: null,
    rowCount: 1,
    chunks: [{ key: "serving/feed_1/things/chunks/one.json", rows: 1, first: "a", last: "a" }],
    changesKey: null,
    seriesKey: null,
    seriesChangesKey: null,
    updatedAt: "2026-09-10T01:00:00.000Z",
    createdAt: "2026-09-10T01:00:00.000Z",
  };
}

function makeBaseline(database: DatabaseSync, version: number): void {
  database.exec(`DROP TABLE schema_migrations; UPDATE meta SET value = '${version}' WHERE key = 'schema_version'`);
}

describe("checked durable migrations", () => {
  it("still drops a chain of referencing tables children before parents when explicit test cleanup asks it to", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY);
      CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id));
      INSERT INTO parent VALUES ('p');
      INSERT INTO child VALUES ('c', 'p');
    `);
    const sql = sqliteStorage(database);
    dropAllTables(sql);
    expect(userTables(sql)).toEqual([]);
  });

  it("migrates a Registry from production schema 201 without losing feeds, products, claims, status, activity, or sync state", async () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database), transaction(database));
    store.migrate();
    const definition = await feed();
    const acquisition = {
      id: "acq_1",
      feedId: definition.id,
      trigger: "scheduled",
      status: "succeeded" as const,
      requestedAt: "2026-09-10T01:00:00.000Z",
      completedAt: "2026-09-10T01:01:00.000Z",
    };
    store.upsertFeed(definition);
    store.setFeedStatus(definition.id, { consecutiveFailures: 0, lastSuccessAt: acquisition.completedAt }, acquisition.completedAt);
    store.replaceFeedProducts(definition.id, [entry()]);
    store.upsertActivity(acquisition.id, definition.id, acquisition.completedAt, acquisition);
    store.setState("catalog-sync", { nextCheckAt: 123, queue: [], hashes: { [definition.slug]: "hash" }, lastCheckedAt: acquisition.completedAt });
    makeBaseline(database, REGISTRY_SCHEMA_BASELINE);

    new RegistryStore(sqliteStorage(database), transaction(database)).migrate();

    expect(database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value).toBe(String(REGISTRY_SCHEMA_VERSION));
    expect(store.getFeed(definition.id)).toMatchObject({ id: definition.id, lastSuccessAt: acquisition.completedAt });
    expect(store.getProductBySlug("things")).toEqual(entry());
    expect(database.prepare("SELECT feed_id FROM claims WHERE slug = 'things'").get()).toEqual({ feed_id: definition.id });
    expect(store.listActivity(10)).toEqual([acquisition]);
    expect(store.getState("catalog-sync")).toEqual({ nextCheckAt: 123, queue: [], hashes: { [definition.slug]: "hash" }, lastCheckedAt: acquisition.completedAt });
  });

  it("adds durable Registry rehydration tables to schema 202 without touching active products", async () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database), transaction(database));
    store.migrate();
    const definition = await feed();
    store.upsertFeed(definition);
    store.replaceFeedProducts(definition.id, [entry()]);
    database.exec(`
      DROP TABLE rehydration_products;
      DROP TABLE rehydration_claims;
      DROP TABLE rehydration_progress;
      DELETE FROM schema_migrations WHERE id >= 203;
      UPDATE meta SET value = '202' WHERE key = 'schema_version';
    `);

    new RegistryStore(sqliteStorage(database), transaction(database)).migrate();

    expect(store.getProductBySlug("things")).toEqual(entry());
    expect(userTables(sqliteStorage(database))).toEqual(expect.arrayContaining(["rehydration_claims", "rehydration_products", "rehydration_progress"]));
    expect(database.prepare("SELECT id, name FROM schema_migrations WHERE id = 203").get()).toEqual({ id: 203, name: "durable-product-rehydration" });
    expect(database.prepare("SELECT id, name FROM schema_migrations WHERE id = 204").get()).toEqual({ id: 204, name: "publication-receipts" });
    expect(userTables(sqliteStorage(database))).toContain("accepted_publications");
  });

  it("migrates a Runner from production schema 202 without losing feed, products, committed outbox, garbage, checkpoint, or acquisitions", async () => {
    const database = new DatabaseSync(":memory:");
    const core = runner(database);
    core.migrate();
    const definition = await feed();
    core.configure(definition);
    core.setRuntime({ consecutiveFailures: 0, consecutiveInterruptions: 0, checkpoint: { normalizer: { id: "fixture", version: "1" }, state: { cursor: "cursor" } } });
    database.prepare("INSERT INTO products (product_key, slug, mode, entry_json, regenerate) VALUES (?, ?, 'small', ?, 0)").run("things", "things", JSON.stringify(entry()));
    database.exec(`
      ALTER TABLE outbox RENAME TO outbox_204;
      CREATE TABLE outbox (
        seq INTEGER PRIMARY KEY, acquisition_id TEXT NOT NULL, lake_table TEXT NOT NULL, rows_json TEXT NOT NULL,
        rows INTEGER NOT NULL, bytes INTEGER NOT NULL, committed INTEGER NOT NULL DEFAULT 0, committed_at TEXT);
      DROP TABLE outbox_204;
      CREATE INDEX outbox_acquisition ON outbox(acquisition_id);
      ALTER TABLE garbage RENAME TO garbage_204;
      CREATE TABLE garbage (object_key TEXT PRIMARY KEY, delete_after TEXT NOT NULL);
      DROP TABLE garbage_204;
      INSERT INTO acquisitions (id, trigger, status, requested_at, completed_at) VALUES ('acq_1', 'scheduled', 'succeeded', '2026-09-10T01:00:00.000Z', '2026-09-10T01:01:00.000Z');
      INSERT INTO garbage (object_key, delete_after) VALUES ('serving/old.json', '2026-09-11T00:00:00.000Z');
    `);
    const oversizedRows = JSON.stringify([
      {
        batch_id: "acq_1",
        revision_id: "rev_1",
        feed_id: "feed_1",
        product_slug: "readings",
        normalizer_id: "fixture",
        normalizer_version: "1",
        schema: {},
        series_key: "temp",
        event_time: "2026-09-10T01:00:00.000Z",
        value: 1,
        unit: "C",
        dimensions: { note: "x".repeat(900_000) },
        observed_at: "2026-09-10T01:00:00.000Z",
        acquisition_id: "acq_1",
      },
    ]);
    database
      .prepare(
        `INSERT INTO outbox (acquisition_id, lake_table, rows_json, rows, bytes, committed, committed_at) VALUES ('acq_1', 'points', ?, 1, ?, 1, '2026-09-10T01:01:00.000Z')`,
      )
      .run(oversizedRows, Buffer.byteLength(oversizedRows));
    makeBaseline(database, RUNNER_SCHEMA_BASELINE);

    runner(database).migrate();

    expect(database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value).toBe(String(RUNNER_SCHEMA_VERSION));
    expect(core.feed()).toMatchObject({ id: definition.id });
    expect(core.productPlans().map((product) => product.entry)).toEqual([entry()]);
    expect(core.pendingOutbox(10)).toEqual([{ seq: 1, table: "points", rowsJson: oversizedRows }]);
    expect(database.prepare("SELECT id, name FROM schema_migrations WHERE id = 204").get()).toEqual({ id: 204, name: "publication-and-outbox-claims" });
    expect(database.prepare("SELECT publication_id, delete_after FROM garbage WHERE object_key = 'serving/old.json'").get()).toMatchObject({
      publication_id: expect.stringMatching(/^publication_/),
      delete_after: "2026-09-11T00:00:00.000Z",
    });
    expect(database.prepare("SELECT claim_token, claim_owner, claim_expires_at FROM outbox WHERE seq = 1").get()).toEqual({
      claim_token: null,
      claim_owner: null,
      claim_expires_at: null,
    });
    const owner = "workflow:migration-test";
    const outbox = {
      claimOutbox: async (limit: number) => core.claimOutbox(owner, limit),
      acknowledgeOutbox: async (token: string, next: number) => core.acknowledgeOutbox(owner, token, next),
      releaseOutbox: async (token: string) => core.releaseOutbox(owner, token),
    };
    const lake = new PipelinesLake({ LAKE_RECORDS: { send: async () => undefined }, LAKE_POINTS: { send: async () => undefined } });
    await expect(drainOutbox(outbox, (table, rows) => lake.send(table, rows), 4)).rejects.toThrow(/Pipeline rows/);
    expect(core.pendingOutbox(10)).toEqual([{ seq: 1, table: "points", rowsJson: oversizedRows }]);
    expect(core.servingKeys()).toContain("serving/old.json");
    expect(core.runtime().checkpoint).toEqual({ normalizer: { id: "fixture", version: "1" }, state: { cursor: "cursor" } });
    expect(core.listAcquisitions(10).map((acquisition) => acquisition.id)).toEqual(["acq_1"]);
  });

  it.each([
    ["Registry", REGISTRY_SCHEMA_VERSION],
    ["Runner", RUNNER_SCHEMA_VERSION],
  ])("fails closed on an unsupported newer %s schema without deleting tables", async (owner, version) => {
    const database = new DatabaseSync(":memory:");
    if (owner === "Registry") {
      const store = new RegistryStore(sqliteStorage(database), transaction(database));
      store.migrate();
      store.setState("sentinel", "kept");
    } else {
      const core = runner(database);
      core.migrate();
      core.setState("sentinel", "kept");
    }
    database.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(version + 1));
    const before = userTables(sqliteStorage(database));

    const migrate = () => (owner === "Registry" ? new RegistryStore(sqliteStorage(database), transaction(database)).migrate() : runner(database).migrate());
    expect(migrate).toThrow(/newer than supported/);
    expect(userTables(sqliteStorage(database))).toEqual(before);
    const stateTable = owner === "Registry" ? "registry_state" : "state";
    expect(database.prepare(`SELECT value_json FROM ${stateTable} WHERE key = 'sentinel'`).get()).toEqual({ value_json: '"kept"' });
  });

  it.each(["Registry", "Runner"])("fails closed when a %s migration checksum no longer matches", (owner) => {
    const database = new DatabaseSync(":memory:");
    if (owner === "Registry") new RegistryStore(sqliteStorage(database), transaction(database)).migrate();
    else runner(database).migrate();
    database.exec("UPDATE schema_migrations SET checksum = 'changed'");
    const before = userTables(sqliteStorage(database));

    const migrate = () => (owner === "Registry" ? new RegistryStore(sqliteStorage(database), transaction(database)).migrate() : runner(database).migrate());
    expect(migrate).toThrow(/checksum mismatch/);
    expect(userTables(sqliteStorage(database))).toEqual(before);
  });

  it("runs the Registry's production terminology migration in place", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database), transaction(database));
    store.migrate();
    database.exec(`
      INSERT INTO feeds (id, slug, definition_json, enabled, title)
      VALUES ('feed_1', 'things', '{"id":"feed_1","gatekeeperKind":"fixture"}', 1, 'Things');
      ALTER TABLE backfills RENAME COLUMN library TO gatekeeper_kind;
      INSERT INTO backfills (feed_id, gatekeeper_kind, status, updated_at)
      VALUES ('feed_1', 'fixture', 'running', '2026-09-18T00:00:00.000Z');
    `);
    makeBaseline(database, REGISTRY_SCHEMA_BASELINE);

    store.migrate();

    expect(store.getFeed("feed_1")).toMatchObject({ id: "feed_1", library: "fixture" });
    expect(store.getFeed("feed_1")).not.toHaveProperty("gatekeeperKind");
    expect(database.prepare("SELECT library FROM backfills WHERE feed_id = 'feed_1'").get()).toEqual({ library: "fixture" });
  });

  it("runs the Runner's production terminology migration in place", () => {
    const database = new DatabaseSync(":memory:");
    const core = runner(database);
    core.migrate();
    database.prepare("INSERT INTO state (key, value_json) VALUES ('feed', ?)").run(JSON.stringify({ id: "feed_1", gatekeeperKind: "fixture" }));
    makeBaseline(database, RUNNER_SCHEMA_BASELINE);

    core.migrate();

    expect(core.feed()).toMatchObject({ id: "feed_1", library: "fixture" });
    expect(core.feed()).not.toHaveProperty("gatekeeperKind");
  });
});
