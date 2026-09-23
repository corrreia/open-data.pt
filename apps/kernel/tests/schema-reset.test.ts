import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ObjectStore } from "../src/object-store";
import { RegistryStore, REGISTRY_SCHEMA_VERSION } from "../src/registry-store";
import { RunnerCore } from "../src/runner-core";
import { dropAllTables, userTables } from "../src/sqlite-reset";
import { MemorySnapshots } from "./kernel-harness";
import { sqliteStorage } from "./sqlite-storage";

/**
 * Production Registries hold tables from older schemas, created parent first
 * and filled with rows that reference each other. SQLite in Durable Objects
 * enforces foreign keys, as node:sqlite does by default, so dropping them in
 * creation order fails the way the 2026-09-10 deploy did.
 */
function oldRegistry(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE policies (id TEXT PRIMARY KEY);
    CREATE TABLE feeds (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL REFERENCES policies(id));
    CREATE TABLE transform_runs (id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES feeds(id));
    INSERT INTO meta VALUES ('schema_version', '100');
    INSERT INTO policies VALUES ('policy_1');
    INSERT INTO feeds VALUES ('feed_1', 'policy_1');
    INSERT INTO transform_runs VALUES ('run_1', 'feed_1');
  `);
  return database;
}

describe("schema reset", () => {
  it("cannot drop old tables in creation order while their rows reference each other", () => {
    expect(() => oldRegistry().exec("DROP TABLE policies")).toThrow(/FOREIGN KEY/);
  });

  it("drops a chain of referencing tables in passes, children before parents", () => {
    const sql = sqliteStorage(oldRegistry());
    dropAllTables(sql);
    expect(userTables(sql)).toEqual([]);
  });

  it("resets a Registry left by an older schema and starts it empty", () => {
    const database = oldRegistry();
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    const version = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    expect(version?.value).toBe(String(REGISTRY_SCHEMA_VERSION));
    expect(database.prepare("SELECT COUNT(*) AS count FROM feeds").get()?.count).toBe(0);
    expect(userTables(sqliteStorage(database))).not.toContain("transform_runs");
  });

  it("renames a Registry feed's library and backfill grouping in place", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    database.exec(`
      INSERT INTO registry_state (key, value_json)
      VALUES ('example-sync', '{"nextCheckAt":99,"nextResolveAllAt":99,"queue":[{"op":"apply","kind":"fixture"}],"hashes":{}}');
      INSERT INTO policies (id, name, version, collection_json, serving_json, created_at)
      VALUES ('policy_1', 'Fixture', 1, '{}', '{}', '2026-09-18T00:00:00.000Z');
      INSERT INTO feeds (id, slug, definition_json, policy_id, enabled, title)
      VALUES ('feed_1', 'things', '{"id":"feed_1","gatekeeperKind":"fixture"}', 'policy_1', 1, 'Things');
      ALTER TABLE backfills RENAME COLUMN library TO gatekeeper_kind;
      INSERT INTO backfills (feed_id, gatekeeper_kind, status, updated_at)
      VALUES ('feed_1', 'fixture', 'running', '2026-09-18T00:00:00.000Z');
    `);

    store.migrate();

    expect(store.getFeed("feed_1")).toMatchObject({ id: "feed_1", library: "fixture" });
    expect(store.getFeed("feed_1")).not.toHaveProperty("gatekeeperKind");
    expect(store.getState<{ nextCheckAt: number; queue: unknown[] }>("example-sync")).toMatchObject({ nextCheckAt: 0, queue: [] });
    expect(database.prepare("SELECT library FROM backfills WHERE feed_id = 'feed_1'").get()).toEqual({ library: "fixture" });
  });

  it("gives a feed installed before feeds named their dataset its slug as one, until a sync names the real one", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    database.exec(`
      INSERT INTO policies (id, name, version, collection_json, serving_json, created_at)
      VALUES ('policy_1', 'Fixture', 1, '{}', '{}', '2026-09-18T00:00:00.000Z');
      INSERT INTO feeds (id, slug, definition_json, policy_id, enabled, title)
      VALUES ('feed_1', 'things', '{"id":"feed_1","slug":"things","library":"fixture"}', 'policy_1', 1, 'Things'),
             ('feed_2', 'others', '{"id":"feed_2","slug":"others","library":"fixture","dataset":"fixture-others"}', 'policy_1', 1, 'Others');
    `);

    store.migrate();

    expect(store.getFeed("feed_1")).toMatchObject({ dataset: "things" });
    expect(store.getFeed("feed_2")).toMatchObject({ dataset: "fixture-others" });
  });

  it("renames an existing runner's feed library before its first read", () => {
    const database = new DatabaseSync(":memory:");
    const sql = sqliteStorage(database);
    const core = new RunnerCore(sql, (body) => body(), {
      objects: new ObjectStore(new MemorySnapshots()),
      publish: async () => true,
      claim: async () => undefined,
      lakeAvailable: true,
      now: () => 0,
    });
    core.migrate();
    database.prepare("INSERT INTO state (key, value_json) VALUES ('feed', ?)").run(JSON.stringify({ id: "feed_1", gatekeeperKind: "fixture" }));

    core.migrate();

    expect(core.feed()).toMatchObject({ id: "feed_1", library: "fixture" });
    expect(core.feed()).not.toHaveProperty("gatekeeperKind");
  });
});
