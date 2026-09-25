import { describe, expect, it } from "vitest";
import { CollectionFailed, failureFrom } from "../src/engine";
import { BACKFILL_RESUME_MS, BACKFILL_START_DELAY_MS, COOLDOWN_BASE_MS, MAX_FAILURE_WAIT_SECONDS, nextRunAfter } from "../src/runner-core";
import { kernelHarness, policy, record, type KernelHarness } from "./kernel-harness";

const HOUR = 3_600_000;
const refused = () => failureFrom(new CollectionFailed("Gatekeeper collection failed: invalid-config", false));
const unreachable = () => failureFrom(new CollectionFailed("Gatekeeper collection failed: upstream-error", true));

/** Start a live acquisition and fail it permanently; returns its id. */
function failPermanently(h: KernelHarness, acquisitionId = h.core.collectNow("manual").id): string {
  h.core.markStarted(acquisitionId, `instance-${acquisitionId}`);
  h.core.fail(acquisitionId, refused());
  return acquisitionId;
}

/** Fail a feed transiently `times` in a row, and answer how many seconds it waited after each one. */
function waitsAfterFailing(h: KernelHarness, times: number): number[] {
  const waits: number[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    const acquisition = h.core.collectNow("scheduled");
    h.core.markStarted(acquisition.id, `instance-${attempt}`);
    h.core.fail(acquisition.id, unreachable());
    waits.push((Date.parse(h.core.runtime().nextRunAt!) - h.clock.now) / 1000);
  }
  return waits;
}

describe("runner schedule and failure handling", () => {
  it("schedules the next live collection one cadence after success", async () => {
    const h = await kernelHarness();
    h.source.records = [record("a", 1)];
    await h.collect();
    const next = Date.parse(h.core.runtime().nextRunAt!);
    expect(next - h.clock.now).toBeGreaterThan(3500_000);
    expect(h.core.takeDue()).toBeUndefined();
    h.clock.now = next;
    expect(h.core.takeDue()?.trigger).toBe("scheduled");
  });

  it("backs off retryable failures and discards everything the failed attempt staged", async () => {
    const h = await kernelHarness();
    const acquisition = h.core.collectNow("manual");
    h.core.markStarted(acquisition.id, "instance");
    h.core.begin(acquisition.id);
    h.core.appendOutbox(acquisition.id, "records", "[]", 1);
    h.core.fail(acquisition.id, failureFrom(new CollectionFailed("Gatekeeper collection failed: upstream-error", true)));
    expect(h.core.pendingOutbox(10)).toHaveLength(0);
    expect(h.core.committedOutboxRows()).toBe(0);
    const runtime = h.core.runtime();
    expect(runtime.consecutiveFailures).toBe(1);
    expect(runtime.runningAcquisitionId).toBeUndefined();
    expect(Date.parse(runtime.nextRunAt!) - h.clock.now).toBe(120_000);
    expect(h.core.getAcquisition(acquisition.id)?.status).toBe("failed");
  });

  it("keeps backing off past the retry limit, but never waits longer than six hours whatever the cadence", async () => {
    const monthly = await kernelHarness({ policy: policy({ cadenceSeconds: 30 * 24 * 3600 }) });
    // Quick retries first, then rests that keep doubling up to the ceiling: a transient failure must not
    // park a monthly feed for a month.
    expect(waitsAfterFailing(monthly, 10)).toEqual([120, 240, 480, 960, 1920, 3840, 7680, 15360, 21600, 21600]);
    expect(MAX_FAILURE_WAIT_SECONDS).toBe(21600);
    const hourly = await kernelHarness({ policy: policy({ cadenceSeconds: 3600 }) });
    expect(waitsAfterFailing(hourly, 6)).toEqual([120, 240, 480, 960, 1920, 3600]);
    // A feed collected every minute still rests its own cadence, as it did before: the cap only shortens waits.
    const minutely = await kernelHarness({ policy: policy({ cadenceSeconds: 60 }) });
    expect(waitsAfterFailing(minutely, 6)).toEqual([120, 240, 480, 60, 60, 60]);
  });

  it("waits as long as a source asked, up to the same six hours", async () => {
    const h = await kernelHarness({ policy: policy({ cadenceSeconds: 3600 }) });
    const askedFor = (seconds: number): number => {
      const acquisition = h.core.collectNow("scheduled");
      h.core.markStarted(acquisition.id, `instance-${seconds}`);
      h.core.fail(acquisition.id, failureFrom(new CollectionFailed("Gatekeeper collection failed: upstream-error", true, seconds)));
      return (Date.parse(h.core.runtime().nextRunAt!) - h.clock.now) / 1000;
    };
    // An hour asked for is an hour waited: talking a rate-limited source down to fifteen minutes is how we get refused.
    expect(askedFor(3600)).toBe(3600);
    // Past the ceiling the source is still held to six hours, and a shorter request never shortens the backoff.
    expect(askedFor(5 * 24 * 3600)).toBe(MAX_FAILURE_WAIT_SECONDS);
    expect(askedFor(5)).toBe(480);
  });

  it("forgets the failure streak when the Registry sends a changed definition, so the next failure retries fast", async () => {
    const h = await kernelHarness({ policy: policy({ cadenceSeconds: 30 * 24 * 3600 }) });
    expect(waitsAfterFailing(h, 6).at(-1)).toBe(3840);
    expect(h.core.configure({ ...h.core.feed()!, title: "Things, renamed" }, h.core.policy()!)).toBe(true);
    expect(h.core.runtime().consecutiveFailures).toBe(0);
    expect(waitsAfterFailing(h, 1)).toEqual([120]);
  });

  it("cools a permanent failure down for six hours, then retries the same acquisition by itself", async () => {
    const h = await kernelHarness();
    const failed = failPermanently(h);
    const until = h.core.runtime().cooldownUntil!;
    expect(Date.parse(until) - h.clock.now).toBe(COOLDOWN_BASE_MS);
    expect(h.core.status()).toMatchObject({ cooldownUntil: until, lastAcquisitionStatus: "failed" });
    expect(h.core.status().lastError).toMatch(/invalid-config.*Retrying automatically after/);
    // No tight loop and no idle wake-up: nothing is due, and the runner sleeps until the cooldown ends.
    expect(h.core.takeDue()).toBeUndefined();
    expect(h.core.nextAlarm()).toBe(Date.parse(until));
    h.clock.now = Date.parse(until) - 60_000;
    expect(h.core.takeDue()).toBeUndefined();
    h.clock.now = Date.parse(until);
    expect(h.core.takeDue()?.id).toBe(failed);
    expect(h.core.runtime().cooldownUntil).toBeUndefined();
    expect(h.core.status().cooldownUntil).toBeUndefined();
  });

  it("doubles the cooldown on every repeat up to 48 hours, and a success forgets it", async () => {
    const h = await kernelHarness();
    const waits: number[] = [];
    let acquisitionId = failPermanently(h);
    for (let round = 0; round < 5; round += 1) {
      const until = Date.parse(h.core.runtime().cooldownUntil!);
      waits.push((until - h.clock.now) / HOUR);
      h.clock.now = until;
      const retried = h.core.takeDue()!;
      expect(retried.id).toBe(acquisitionId);
      if (round < 4) acquisitionId = failPermanently(h, retried.id);
      else {
        h.source.records = [record("a", 1)];
        h.core.markStarted(retried.id, "instance-repaired");
        expect((await h.run(retried.id)).status).toBe("succeeded");
      }
    }
    expect(waits).toEqual([6, 12, 24, 48, 48]);
    expect(h.core.runtime().cooldowns).toBe(0);
    failPermanently(h);
    expect(Date.parse(h.core.runtime().cooldownUntil!) - h.clock.now).toBe(COOLDOWN_BASE_MS);
  });

  it("cools down after three consecutive executor interruptions (memory or CPU kills) instead of looping", async () => {
    const h = await kernelHarness();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const acquisition = h.core.collectNow("scheduled");
      h.core.markStarted(acquisition.id, `instance-${attempt}`);
      h.core.fail(acquisition.id, failureFrom(new Error("Worker exceeded memory limit")));
      expect(Boolean(h.core.runtime().cooldownUntil)).toBe(attempt === 3);
    }
    expect(h.core.status().lastError).toMatch(/interrupted 3 times.*Retrying automatically after/s);
  });

  it("ends a cooldown when the Registry sends a changed definition, but not when it re-sends the same one", async () => {
    const h = await kernelHarness();
    const failed = failPermanently(h);
    const feed = h.core.feed()!;
    const feedPolicy = h.core.policy()!;
    // The daily re-resolve re-sends every feed; an identical definition, even rewritten later, must not cut the cooldown short.
    expect(h.core.configure({ ...feed, updatedAt: "2026-09-11T00:00:00.000Z" }, { ...feedPolicy, createdAt: "2026-09-11T00:00:00.000Z" })).toBe(false);
    expect(h.core.runtime().cooldownUntil).toBeDefined();
    expect(h.core.takeDue()).toBeUndefined();
    expect(h.core.configure({ ...feed, title: "Things, renamed" }, feedPolicy)).toBe(true);
    expect(h.core.runtime().cooldownUntil).toBeUndefined();
    expect(h.core.takeDue()?.id).toBe(failed);
  });

  it("ignores a failure reported again, or by an attempt that is no longer running", async () => {
    const h = await kernelHarness();
    const failed = failPermanently(h);
    const runtime = h.core.runtime();
    h.core.fail(failed, refused());
    expect(h.core.runtime()).toEqual(runtime);
  });

  it("reports an overdue executor through the watchdog", async () => {
    const h = await kernelHarness();
    const acquisition = h.core.collectNow("manual");
    h.core.markStarted(acquisition.id, "instance");
    expect(h.core.overdue()).toBeUndefined();
    h.clock.now += 10 * 60_000;
    expect(h.core.overdue()).toBe(acquisition.id);
    h.core.extendWatchdog(acquisition.id);
    expect(h.core.overdue()).toBeUndefined();
  });

  it("sleeps until its next run, waking earlier only to delete superseded serving objects", async () => {
    const h = await kernelHarness({ policy: policy({ cadenceSeconds: 7 * 24 * 3600 }), history: null });
    for (const value of [1, 2, 3]) {
      h.source.records = [record("a", value)];
      await h.collect();
    }
    expect(h.core.nextAlarm()! - h.clock.now).toBeLessThanOrEqual(HOUR);
    // Every version discards what the one before served; once all of it is gone, only the next run remains.
    h.clock.now += 2 * HOUR;
    expect(await h.core.collectGarbage()).toBeGreaterThan(0);
    expect(h.core.nextAlarm()! - h.clock.now).toBeGreaterThan(6 * 24 * HOUR);
  });

  it("takes no new work once decommissioned, and a new definition adopts it again", async () => {
    const h = await kernelHarness();
    h.core.decommission();
    expect(h.core.retiring()).toBe(true);
    expect(h.core.takeDue()).toBeUndefined();
    // The same definition, but adopted again after being dropped, is a change: the runner must plan its wake-ups again.
    expect(h.core.configure(h.core.feed()!, h.core.policy()!)).toBe(true);
    expect(h.core.retiring()).toBe(false);
    expect(h.core.takeDue()?.trigger).toBe("scheduled");
  });
});

describe("automatic history walk", () => {
  it("starts once, ten minutes after the first live success, back to the ten-year floor", async () => {
    const h = await kernelHarness();
    h.source.records = [record("a", 1)];
    expect(h.core.backfillSummary()).toBeUndefined();
    await h.collect();
    const started = h.core.backfillSummary()!;
    expect(started.status).toBe("running");
    expect((h.clock.now - Date.parse(started.until!)) / (365.25 * 24 * HOUR)).toBeCloseTo(10, 0);
    await h.collect();
    expect(h.core.backfillSummary()?.startedAt).toBe(started.startedAt);
    expect(h.core.takeDue()).toBeUndefined();
    h.clock.now += BACKFILL_START_DELAY_MS;
    expect(h.core.takeDue()?.trigger).toBe("history");
  });

  it("stops at the source's stated beginning when that is more recent than the floor", async () => {
    const h = await kernelHarness({ history: { earliest: "2020-01-01T00:00:00.000Z" } });
    h.source.records = [record("a", 1)];
    await h.collect();
    expect(h.core.backfillSummary()?.until).toBe("2020-01-01T00:00:00.000Z");
  });

  it("never starts for a feed whose source offers no history", async () => {
    const h = await kernelHarness({ history: null });
    h.source.records = [record("a", 1)];
    await h.collect();
    expect(h.core.backfillSummary()).toBeUndefined();
  });

  it("waits between slices as long as the source states one may be read, over its own pacing", async () => {
    const h = await kernelHarness({ policy: policy({ cadenceSeconds: 7 * 24 * 3600 }), history: { minSliceSeconds: 300 } });
    h.source.records = [record("a", 1)];
    await h.collect();
    h.clock.now += BACKFILL_START_DELAY_MS;
    const slice = h.core.takeDue()!;
    expect(slice.trigger).toBe("history");
    const before = Date.parse(h.core.backfillSummary()!.cursor) - 24 * HOUR;
    h.source.fetch = async () => ({
      kind: "body",
      body: new Uint8Array(0),
      provenance: { sourceUrl: "https://example.test/things" },
      completeness: "complete",
      next: { before: new Date(before).toISOString() },
    });
    h.core.markStarted(slice.id, "history-1");
    await h.run(slice.id);
    expect(h.core.backfillSummary()?.slices).toBe(1);
    // Anything due within the next second is taken now, so the last moment still waiting is two seconds short.
    h.clock.now += 298_000;
    expect(h.core.takeDue()?.trigger, "the kernel's own twenty seconds are not enough").toBeUndefined();
    h.clock.now += 2_000;
    expect(h.core.takeDue()?.trigger).toBe("history");
  });

  it("pauses after repeated transient failures and resumes by itself a day later", async () => {
    const h = await kernelHarness({ policy: policy({ cadenceSeconds: 7 * 24 * 3600 }) });
    h.source.records = [record("a", 1)];
    await h.collect();
    h.clock.now += BACKFILL_START_DELAY_MS;
    for (let failure = 1; failure <= 5; failure += 1) {
      const slice = h.core.takeDue()!;
      expect(slice.trigger).toBe("history");
      h.core.markStarted(slice.id, `history-${failure}`);
      h.core.fail(slice.id, { message: "upstream timeout", retryable: true });
      h.clock.now += 120_000 * failure;
    }
    expect(h.core.backfillSummary()?.status).toBe("paused");
    expect(h.core.takeDue()).toBeUndefined();
    h.clock.now += BACKFILL_RESUME_MS;
    expect(h.core.takeDue()?.trigger).toBe("history");
    expect(h.core.backfillSummary()).toMatchObject({ status: "running", failures: 0 });
  });
});

describe("durable acceptance, publication and history delivery", () => {
  it("commits history before publication and retries publication until the Registry accepts it", async () => {
    const h = await kernelHarness();
    h.source.records = [record("a", 1), record("b", 2)];
    h.failPublish.next = true;
    const first = await h.collect();
    expect(first.status).toBe("succeeded");
    expect(first.historyRows).toBe(2);
    expect(h.published).toHaveLength(0);
    expect(h.lakeRows("records")).toHaveLength(2);
    const acquisition = h.core.collectNow("manual");
    h.core.markStarted(acquisition.id, "instance");
    expect(() => h.core.begin(acquisition.id)).toThrow(/still being published/);
    await h.core.publishPending();
    expect(h.entry()?.rowCount).toBe(2);
    expect(h.core.begin(acquisition.id).kind).toBe("run");
  });

  it("reports how much history a collection committed, so an unchanged one needs no delivery", async () => {
    const h = await kernelHarness();
    h.source.records = [record("a", 1)];
    expect((await h.collect()).historyRows).toBe(1);
    const again = await h.collect();
    expect(again).toMatchObject({ status: "unchanged", historyRows: 0 });
  });

  it("deletes the chunks and windows a new version no longer serves, after a grace period", async () => {
    const h = await kernelHarness();
    const served: string[] = [];
    for (const value of [1, 2, 3]) {
      h.source.records = [record("a", value)];
      await h.collect();
      served.push(h.entry()!.chunks![0]!.key);
    }
    expect(served.every((key) => h.snapshots.objects.has(key))).toBe(true);
    h.clock.now += 2 * 60 * 60_000;
    expect(await h.core.collectGarbage()).toBeGreaterThan(0);
    expect(served.map((key) => h.snapshots.objects.has(key))).toEqual([false, false, true]);
    expect(await h.served()).toHaveLength(1);
    expect(h.snapshots.putKeys.some((key) => key.includes("/manifests/"))).toBe(false);
  });

  it("keeps an object a newer version serves again, even after an older one discarded it", async () => {
    const h = await kernelHarness();
    for (const value of [1, 2, 1]) {
      h.source.records = [record("a", value)];
      await h.collect();
    }
    const current = h.entry()!.chunks![0]!.key;
    h.clock.now += 2 * 60 * 60_000;
    await h.core.collectGarbage();
    expect(h.snapshots.objects.has(current)).toBe(true);
    expect(await h.served()).toHaveLength(1);
  });

  it("resets its schema instead of migrating an unknown version", async () => {
    const h = await kernelHarness();
    h.source.records = [record("a", 1)];
    await h.collect();
    h.core.setState("probe", 1);
    expect(h.core.getState<number>("probe")).toBe(1);
  });
});

describe("when a feed runs next", () => {
  const now = Date.parse("2026-09-25T15:00:00.000Z");

  it("runs a feed read more often than daily as soon as its cadence has passed", () => {
    expect(nextRunAfter("feed_a", now, 3_600)).toBe("2026-09-25T16:00:00.000Z");
  });

  it("runs a daily-or-slower feed at a time of day of its own: never sooner, at most a day later, the same every time", () => {
    const month = 2_592_000;
    const due = now + month * 1000;
    const times = Array.from({ length: 278 }, (_, index) => Date.parse(nextRunAfter(`feed_${index}`, now, month)));
    for (const at of times) {
      expect(at).toBeGreaterThanOrEqual(due);
      expect(at).toBeLessThan(due + 86_400_000);
    }
    expect(nextRunAfter("feed_7", now, month)).toBe(nextRunAfter("feed_7", now, month));
    // A day later, the same feed keeps its time of day.
    expect(nextRunAfter("feed_7", now + 86_400_000, 86_400).slice(11)).toBe(nextRunAfter("feed_7", now, 86_400).slice(11));
    // 278 feeds installed together spread over the day rather than running in one burst.
    const hours = new Set(times.map((at) => new Date(at).getUTCHours()));
    expect(hours.size).toBe(24);
  });
});
