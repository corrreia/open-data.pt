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

/** The Registry's feeds and policies tables as they were before feeds carried their own policy. */
function withProtocolFourTables(database: DatabaseSync): void {
  database.exec(`
    DROP TABLE feeds;
    CREATE TABLE policies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, collection_json TEXT NOT NULL, serving_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(name, version));
    CREATE TABLE feeds (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, definition_json TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES policies(id), enabled INTEGER NOT NULL, title TEXT NOT NULL);
  `);
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

  it("stores a Registry product once served as a partial snapshot as the delta it behaved as", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    const insert = database.prepare("INSERT INTO products (slug, feed_id, product_key, title, entry_json) VALUES (?, 'feed_1', ?, 'Things', ?)");
    insert.run("partial", "partial", JSON.stringify({ slug: "partial", updateMode: "partial-snapshot" }));
    insert.run("whole", "whole", JSON.stringify({ slug: "whole", updateMode: "authoritative-snapshot" }));

    store.migrate();

    const modes = database.prepare("SELECT slug, json_extract(entry_json, '$.updateMode') AS mode FROM products ORDER BY slug").all();
    expect(modes).toEqual([
      { slug: "partial", mode: "delta" },
      { slug: "whole", mode: "authoritative-snapshot" },
    ]);
  });

  it("renames a Registry feed's library and backfill grouping in place", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    withProtocolFourTables(database);
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
    // The sync of examples became the sync of the catalog: its queue and hashes were examples', so they go.
    expect(store.getState("example-sync")).toBeUndefined();
    expect(store.getState("catalog-sync")).toEqual({ nextCheckAt: 99, queue: [], hashes: {} });
    expect(database.prepare("SELECT library FROM backfills WHERE feed_id = 'feed_1'").get()).toEqual({ library: "fixture" });
  });

  it("gives each feed its dataset's publisher and terms from the catalog stored with it, and forgets the dataset", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    const stored = {
      publishers: [{ id: "ine", name: "INE" }],
      licences: [{ id: "cc-by-4.0", name: "CC BY 4.0", summary: "Reuse with credit." }],
      topics: [{ id: "economy", name: "Economy" }],
      datasets: [{ id: "ine-prices", title: "Prices", description: "CPI", publisher: "ine", licence: "cc-by-4.0", attribution: "Statistics Portugal", topics: ["economy"] }],
    };
    withProtocolFourTables(database);
    database.prepare("INSERT INTO registry_state (key, value_json) VALUES ('catalog', ?)").run(JSON.stringify(stored));
    database.exec(`
      INSERT INTO policies (id, name, version, collection_json, serving_json, created_at)
      VALUES ('policy_1', 'Fixture', 1, '{}', '{}', '2026-09-18T00:00:00.000Z');
      INSERT INTO feeds (id, slug, definition_json, policy_id, enabled, title)
      VALUES ('feed_1', 'prices', '{"id":"feed_1","slug":"prices","library":"ine","dataset":"ine-prices"}', 'policy_1', 1, 'Prices'),
             ('feed_2', 'things', '{"id":"feed_2","slug":"things","library":"fixture"}', 'policy_1', 1, 'Things'),
             ('feed_3', 'moved', '{"id":"feed_3","slug":"moved","library":"fixture","publisher":"ine","licence":"cc-by-4.0","topics":[]}', 'policy_1', 1, 'Moved');
    `);

    store.migrate();

    expect(store.getFeed("feed_1")).toMatchObject({ publisher: "ine", licence: "cc-by-4.0", topics: ["economy"], attribution: "Statistics Portugal" });
    expect(store.getFeed("feed_1")).not.toHaveProperty("dataset");
    // One installed before datasets is its own publisher, with no stated licence, until the next sync names them.
    expect(store.getFeed("feed_2")).toMatchObject({ publisher: "things", licence: "source-terms", topics: [] });
    expect(store.getFeed("feed_2")).not.toHaveProperty("attribution");
    // One that already names its publisher is left alone.
    expect(store.getFeed("feed_3")).toMatchObject({ publisher: "ine", licence: "cc-by-4.0", topics: [] });
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

  it("brings a runner written under protocol 4 to protocol 5 in place, keeping what it collected", () => {
    const { database, core } = protocolFourRunner({});
    const failed = database.prepare("INSERT INTO acquisitions (id, trigger, status, requested_at, error) VALUES (?, 'scheduled', 'failed', '2026-09-27T00:00:00.000Z', ?)");
    failed.run("acq_source", "Gatekeeper collection failed: upstream-error");
    failed.run("acq_cooled", "Gatekeeper collection failed: source-denied Retrying automatically after 2026-09-27T06:00:00.000Z.");
    failed.run("acq_platform", "Illegal invocation");

    core.migrate();
    core.migrate();

    expect(core.runtime().checkpoint).toEqual({ normalizer: FIXTURE_NORMALIZER, state: FIXTURE_STATE });
    expect(JSON.parse(String(database.prepare("SELECT entry_json FROM products").get()?.entry_json))).toEqual({ slug: "things", updateMode: "delta" });
    // A failure's code was named only in its message; the outage it belongs to keeps its cause.
    expect(core.getAcquisition("acq_source")?.errorCode).toBe("upstream-error");
    expect(core.getAcquisition("acq_cooled")?.errorCode).toBe("source-denied");
    expect(core.getAcquisition("acq_platform")).not.toHaveProperty("errorCode");
    // Then its feed takes the identity the catalog now sends and its own policy, and acquisitions forget policy versions.
    expect(core.feed()).toEqual(LIFTED_FEED);
    expect(database.prepare("SELECT COUNT(*) AS count FROM state WHERE key = 'policy'").get()?.count).toBe(0);
    const columns = database
      .prepare("SELECT name FROM pragma_table_info('acquisitions')")
      .all()
      .map((row) => row.name);
    expect(columns).not.toContain("policy_version");
    expect(columns).toContain("error_code");
  });

  it("lifts the Registry's feeds out of their shared policy rows, and drops the policies table", () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    withProtocolFourTables(database);
    database
      .prepare("INSERT INTO policies (id, name, version, collection_json, serving_json, created_at) VALUES ('policy_1', 'Fixture', 1, ?, '{}', '2026-09-10T00:00:00.000Z')")
      .run(JSON.stringify(PROTOCOL_FOUR_COLLECTION));
    database
      .prepare("INSERT INTO feeds (id, slug, definition_json, policy_id, enabled, title) VALUES ('feed_1', 'things', ?, 'policy_1', 1, 'Things')")
      .run(JSON.stringify(PROTOCOL_FOUR_FEED));
    database
      .prepare("INSERT INTO registry_state (key, value_json) VALUES ('example-sync', ?)")
      .run(JSON.stringify({ nextCheckAt: 5, nextResolveAllAt: 9, queue: [{ op: "apply", library: "fixture", example: { slug: "things" }, hash: "h" }], hashes: { things: "h" } }));

    store.migrate();
    store.migrate();

    expect(store.getFeed("feed_1")).toEqual(LIFTED_FEED);
    expect(userTables(sqliteStorage(database))).not.toContain("policies");
    expect(
      database
        .prepare("SELECT name FROM pragma_table_info('feeds')")
        .all()
        .map((row) => row.name),
    ).toEqual(["id", "slug", "definition_json", "enabled", "title"]);
    // Every feed is applied once more from the catalog; nothing queued as an example is run.
    expect(store.getState("catalog-sync")).toEqual({ nextCheckAt: 5, queue: [], hashes: {} });
  });

  it.each([{ resourceKey: "fixture:other" }, { configHash: "another-config" }, { feedEpoch: "another-epoch" }])(
    "drops a protocol 4 checkpoint read under another scope than the runner holds: %j",
    (scope) => {
      const { core } = protocolFourRunner(scope);
      core.migrate();
      expect(core.runtime()).not.toHaveProperty("checkpoint");
    },
  );
});

const FIXTURE_NORMALIZER = { id: "fixture", version: "1" };
const PROTOCOL_FOUR_COLLECTION = { cadenceSeconds: 3600, timeoutSeconds: 60, maxBytes: 1024, historyMode: "changes" };

/** A feed as a runner or the Registry stored it before the catalog carried resolved feeds: config, semantics, a resolved copy, a policy id. */
const PROTOCOL_FOUR_FEED = {
  id: "feed_1",
  slug: "things",
  title: "Things",
  description: "Fixture",
  library: "fixture",
  config: { source: "fixture", feed: "things" },
  semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  feedEpoch: "epoch",
  resolved: {
    config: { source: "fixture", feed: "things" },
    configHash: "config",
    resourceKey: "fixture:things",
    kind: "fixture:things",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
    history: { minSliceSeconds: 60 },
  },
  policyId: "policy_1",
  enabled: true,
  staleAfterSeconds: 7200,
  publisher: "ine",
  licence: "cc-by-4.0",
  topics: ["economy"],
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

/** The same feed as the catalog now installs it. */
const LIFTED_FEED = {
  id: "feed_1",
  slug: "things",
  title: "Things",
  description: "Fixture",
  library: "fixture",
  resourceKey: "fixture:things",
  configHash: "config",
  eventTimed: true,
  history: { minSliceSeconds: 60 },
  policy: PROTOCOL_FOUR_COLLECTION,
  feedEpoch: "epoch",
  enabled: true,
  staleAfterSeconds: 7200,
  publisher: "ine",
  licence: "cc-by-4.0",
  topics: ["economy"],
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};
const FIXTURE_STATE = { validators: { default: { etag: '"v1"' } } };

/**
 * What a protocol 4 runner holds: its feed, a checkpoint in its scope envelope (with `scope` overriding the feed's own),
 * a downgraded snapshot, and an acquisitions table without failure codes.
 */
function protocolFourRunner(scope: { resourceKey?: string; configHash?: string; feedEpoch?: string }) {
  const database = new DatabaseSync(":memory:");
  const core = new RunnerCore(sqliteStorage(database), (body) => body(), {
    objects: new ObjectStore(new MemorySnapshots()),
    publish: async () => true,
    claim: async () => undefined,
    lakeAvailable: true,
    now: () => 0,
  });
  core.migrate();
  database.exec(`ALTER TABLE acquisitions DROP COLUMN error_code`);
  database.exec(`ALTER TABLE acquisitions ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1`);
  const feed = PROTOCOL_FOUR_FEED;
  const checkpoint = { version: 2, resourceKey: "fixture:things", configHash: "config", feedEpoch: "epoch", ...scope, normalizer: FIXTURE_NORMALIZER, state: FIXTURE_STATE };
  const insert = database.prepare("INSERT INTO state (key, value_json) VALUES (?, ?)");
  insert.run("feed", JSON.stringify(feed));
  insert.run("policy", JSON.stringify({ id: "policy_1", name: "Fixture", version: 1, collection: PROTOCOL_FOUR_COLLECTION, createdAt: "2026-09-10T00:00:00.000Z" }));
  insert.run("runtime", JSON.stringify({ checkpoint, consecutiveFailures: 0, consecutiveInterruptions: 0 }));
  database
    .prepare("INSERT INTO products (product_key, slug, mode, entry_json) VALUES ('things', 'things', 'small', ?)")
    .run(JSON.stringify({ slug: "things", updateMode: "partial-snapshot" }));
  return { database, core };
}
