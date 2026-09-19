import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Acquisition } from "../apps/kernel/src/feed-model";
import { RegistryStore } from "../apps/kernel/src/registry-store";
import { ingestRunnerReport, isSustained, type RunnerReport } from "../apps/kernel/src/runner-reporting";
import { fixtureResolved } from "./kernel-harness";
import { sqliteStorage } from "./sqlite-storage";

function acquisition(id: string, requestedAt: string): Acquisition {
  return { id, feedId: "feed_1", trigger: "scheduled", status: "succeeded", requestedAt, completedAt: requestedAt, policyVersion: 1, revisions: 1, historyRows: 1 };
}

function report(lastError: string, acquisitions: Acquisition[]): RunnerReport {
  return { feedId: "feed_1", library: "fixture", status: { consecutiveFailures: 0, lastError }, acquisitions };
}

describe("Registry ingestion", () => {
  it("mirrors status and acquisitions, writes nothing for an identical repeat, and ignores unknown feeds", async () => {
    const database = new DatabaseSync(":memory:");
    const store = new RegistryStore(sqliteStorage(database));
    store.migrate();
    store.upsertPolicy({
      id: "policy_1",
      name: "Fixture",
      version: 1,
      createdAt: "2026-09-10T00:00:00.000Z",
      collection: { cadenceSeconds: 60, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
      serving: { licence: "source-terms" },
    });
    const resolved = await fixtureResolved();
    store.upsertFeed({
      id: "feed_1",
      slug: "things",
      title: "Things",
      description: "",
      library: "fixture",
      config: resolved.config,
      semantics: resolved.semantics,
      resolved,
      feedEpoch: "e",
      policyId: "policy_1",
      enabled: true,
      staleAfterSeconds: 60,
      topics: [],
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
    const payload = report("r1", [acquisition("a", "2026-09-10T01:00:00.000Z")]);
    expect(ingestRunnerReport(store, payload, "2026-09-10T01:00:01.000Z").known).toBe(true);
    const changes = () => Number(database.prepare("SELECT total_changes() AS n").get()?.n ?? 0);
    const before = changes();
    // A report is an idempotent upsert: sending the same one again, as after a lost receipt, writes nothing.
    ingestRunnerReport(store, payload, "2026-09-10T01:00:02.000Z");
    expect(changes() - before).toBe(0);
    expect(store.listActivity(10).map((item) => item.id)).toEqual(["a"]);
    expect(store.getFeed("feed_1")?.lastError).toBe("r1");
    expect(ingestRunnerReport(store, { ...payload, feedId: "ghost" }, "2026-09-10T01:00:03.000Z").known).toBe(false);
  });
});

async function registryWithFeed(): Promise<RegistryStore> {
  const store = new RegistryStore(sqliteStorage(new DatabaseSync(":memory:")));
  store.migrate();
  store.upsertPolicy({
    id: "policy_1",
    name: "Fixture",
    version: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    collection: { cadenceSeconds: 60, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
    serving: { licence: "source-terms" },
  });
  const resolved = await fixtureResolved();
  store.upsertFeed({
    id: "feed_1",
    slug: "things",
    title: "Things",
    description: "",
    library: "fixture",
    config: resolved.config,
    semantics: resolved.semantics,
    resolved,
    feedEpoch: "e",
    policyId: "policy_1",
    enabled: true,
    staleAfterSeconds: 60,
    topics: [],
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  return store;
}

function run(id: string, at: string, status: Acquisition["status"], error?: string, trigger = "scheduled"): Acquisition {
  const item: Acquisition = { id, feedId: "feed_1", trigger, status, requestedAt: at, completedAt: at, policyVersion: 1 };
  if (error) item.error = error;
  return item;
}

const WINDOW = ["2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"] as const;

describe("outages", () => {
  it("says when a day holds more runs than the limit let through", () => {
    const store = new RegistryStore(sqliteStorage(new DatabaseSync(":memory:")));
    store.migrate();
    for (const minute of ["01", "02", "03"])
      store.upsertActivity(`acq_${minute}`, "feed_1", `2026-09-18T00:${minute}:00.000Z`, acquisition(`acq_${minute}`, `2026-09-18T00:${minute}:00.000Z`));
    const cut = store.listActivityBetween("2026-09-18T00:00:00.000Z", "2026-09-19T00:00:00.000Z", 2);
    expect(cut.items.map((item) => item.id)).toEqual(["acq_03", "acq_02"]);
    expect(cut.more).toBe(true);
    const whole = store.listActivityBetween("2026-09-18T00:00:00.000Z", "2026-09-19T00:00:00.000Z", 3);
    expect(whole.items).toHaveLength(3);
    expect(whole.more).toBe(false);
  });

  it("keeps the 5,000 most recent runs, no more", () => {
    const store = new RegistryStore(sqliteStorage(new DatabaseSync(":memory:")));
    store.migrate();
    const base = Date.parse("2026-09-18T00:00:00.000Z");
    for (let index = 0; index < 5_002; index += 1) {
      const at = new Date(base + index * 1000).toISOString();
      store.upsertActivity(`acq_${index}`, "feed_1", at, acquisition(`acq_${index}`, at));
    }
    store.pruneActivity();
    const kept = store.listActivity(10_000);
    expect(kept).toHaveLength(5_000);
    expect(kept.at(-1)?.id).toBe("acq_2");
  });

  it("opens when live collection starts failing, counts the failures, and closes at the first success", async () => {
    const store = await registryWithFeed();
    const upstream = "Gatekeeper collection failed: upstream-error";
    const ok = run("a0", "2026-09-10T09:59:00.000Z", "succeeded");
    const first = run("a1", "2026-09-10T10:00:00.000Z", "failed", upstream);
    const second = run("a2", "2026-09-10T10:02:00.000Z", "failed", upstream);
    ingestRunnerReport(store, { feedId: "feed_1", library: "fixture", status: { consecutiveFailures: 1 }, acquisitions: [first, ok] }, "2026-09-10T10:00:01.000Z");
    ingestRunnerReport(store, { feedId: "feed_1", library: "fixture", status: { consecutiveFailures: 2 }, acquisitions: [second, first, ok] }, "2026-09-10T10:02:01.000Z");
    expect(store.outagesBetween(...WINDOW)).toEqual([{ feedId: "feed_1", startedAt: first.completedAt, cause: "source", failures: 2, lastError: upstream }]);
    const recovered = run("a3", "2026-09-10T10:05:00.000Z", "unchanged");
    const later = run("a4", "2026-09-10T10:06:00.000Z", "succeeded");
    // A lost report means the next one may already hold several successes: the first one ended it.
    ingestRunnerReport(
      store,
      { feedId: "feed_1", library: "fixture", status: { consecutiveFailures: 0 }, acquisitions: [later, recovered, second, first] },
      "2026-09-10T10:06:01.000Z",
    );
    expect(store.outagesBetween(...WINDOW)).toEqual([
      { feedId: "feed_1", startedAt: first.completedAt, endedAt: recovered.completedAt, cause: "source", failures: 2, lastError: upstream },
    ]);
    expect(store.openOutage("feed_1")).toBeUndefined();
  });

  it("tells a source that did not answer from a failure on this platform's side, and ignores failed history walks", async () => {
    const store = await registryWithFeed();
    ingestRunnerReport(
      store,
      {
        feedId: "feed_1",
        library: "fixture",
        status: { consecutiveFailures: 0 },
        acquisitions: [run("h1", "2026-09-10T10:00:00.000Z", "failed", "Gatekeeper collection failed: upstream-error", "history")],
      },
      "2026-09-10T10:00:01.000Z",
    );
    expect(store.outagesBetween(...WINDOW)).toEqual([]);
    ingestRunnerReport(
      store,
      { feedId: "feed_1", library: "fixture", status: { consecutiveFailures: 1 }, acquisitions: [run("a1", "2026-09-10T10:01:00.000Z", "failed", "Illegal invocation")] },
      "2026-09-10T10:01:01.000Z",
    );
    expect(store.outagesBetween(...WINDOW).map((outage) => outage.cause)).toEqual(["collection"]);
  });

  it("records a platform gap when no report arrives for more than ten minutes", async () => {
    const store = await registryWithFeed();
    const tick = (at: string) =>
      ingestRunnerReport(store, { feedId: "feed_1", library: "fixture", status: { consecutiveFailures: 0 }, acquisitions: [run(at, at, "succeeded")] }, at);
    tick("2026-09-10T10:00:00.000Z");
    tick("2026-09-10T10:09:00.000Z");
    expect(store.outagesBetween(...WINDOW)).toEqual([]);
    tick("2026-09-10T10:30:00.000Z");
    tick("2026-09-10T10:31:00.000Z");
    expect(store.outagesBetween(...WINDOW)).toEqual([{ feedId: null, startedAt: "2026-09-10T10:09:00.000Z", endedAt: "2026-09-10T10:30:00.000Z", cause: "platform", failures: 0 }]);
  });
});

describe("downtime the status page shows", () => {
  const at = (minutes: number) => new Date(Date.parse("2026-09-10T10:00:00.000Z") + minutes * 60_000).toISOString();

  it("counts a failure that repeats and lasts ten minutes, not a missed collection the next one repairs", () => {
    expect(isSustained({ feedId: "feed_1", startedAt: at(0), endedAt: at(2), cause: "source", failures: 1 }, at(30))).toBe(false);
    expect(isSustained({ feedId: "feed_1", startedAt: at(0), endedAt: at(60), cause: "source", failures: 1 }, at(90))).toBe(false);
    expect(isSustained({ feedId: "feed_1", startedAt: at(0), endedAt: at(5), cause: "source", failures: 3 }, at(30))).toBe(false);
    expect(isSustained({ feedId: "feed_1", startedAt: at(0), endedAt: at(12), cause: "source", failures: 2 }, at(30))).toBe(true);
  });

  it("shows an ongoing failure once it has lasted ten minutes, and every platform gap", () => {
    expect(isSustained({ feedId: "feed_1", startedAt: at(0), cause: "collection", failures: 4 }, at(9))).toBe(false);
    expect(isSustained({ feedId: "feed_1", startedAt: at(0), cause: "collection", failures: 4 }, at(11))).toBe(true);
    expect(isSustained({ feedId: null, startedAt: at(0), endedAt: at(11), cause: "platform", failures: 0 }, at(30))).toBe(true);
  });
});
