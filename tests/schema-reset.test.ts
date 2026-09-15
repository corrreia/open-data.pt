import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { RegistryStore, REGISTRY_SCHEMA_VERSION } from "../apps/kernel/src/registry-store";
import { dropAllTables, userTables } from "../apps/kernel/src/sqlite-reset";
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
});
