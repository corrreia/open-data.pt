import { describe, expect, it } from "vitest";
import { HOUR_MS, STATUS_DAYS, STATUS_HOURS, measureStatus, statusHours, type StatusHour } from "../apps/site/src/lib/status-history";
import type { Outage } from "../apps/site/src/lib/types";

const START = Date.parse("2026-09-16T10:00:00Z");
const MINUTE = 60_000;
const HOUR: StatusHour = { start: START, end: START + HOUR_MS };

function outage(start: number, end?: number): Outage {
  const result: Outage = { feedId: "fixture", startedAt: new Date(start).toISOString(), cause: "source", failures: 2 };
  if (end !== undefined) result.endedAt = new Date(end).toISOString();
  return result;
}

describe("hourly status history", () => {
  it("uses 72 distinct hourly slots across the three-day view", () => {
    const now = START + 17 * MINUTE;
    const hours = statusHours(now);
    expect(STATUS_DAYS).toBe(3);
    expect(STATUS_HOURS).toBe(72);
    expect(hours).toHaveLength(72);
    expect(hours[0]?.start).toBe(START - 71 * HOUR_MS);
    expect(hours.at(-1)).toEqual(HOUR);
    expect(new Set(hours.map((hour) => hour.start)).size).toBe(72);
    for (let index = 0; index < hours.length; index += 1) {
      expect(hours[index]!.end - hours[index]!.start).toBe(HOUR_MS);
      if (index > 0) expect(hours[index]!.start).toBe(hours[index - 1]!.end);
    }
  });

  it("keeps bucket boundaries stable until the next clock hour", () => {
    expect(statusHours(START + MINUTE)).toEqual(statusHours(START + 59 * MINUTE));
    expect(statusHours(START + HOUR_MS).slice(0, 71)).toEqual(statusHours(START).slice(1));
  });

  it.each(["2026-03-29T02:30:00Z", "2026-10-25T02:30:00Z"])("keeps exact hourly durations across the Lisbon DST transition at %s", (time) => {
    const hours = statusHours(Date.parse(time));
    expect(hours).toHaveLength(72);
    expect(hours.at(-1)!.end - hours[0]!.start).toBe(72 * HOUR_MS);
    expect(hours.every((hour) => hour.end - hour.start === HOUR_MS)).toBe(true);
  });

  it("keeps repeated local hours distinct in absolute time", () => {
    const hours = statusHours(Date.parse("2026-10-25T02:30:00Z"));
    const first = hours.find((hour) => hour.start === Date.parse("2026-10-25T00:00:00Z"))!;
    const second = hours.find((hour) => hour.start === Date.parse("2026-10-25T01:00:00Z"))!;
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
    const withOffset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });
    expect(local.format(first.start)).toBe(local.format(second.start));
    expect(withOffset.format(first.start)).not.toBe(withOffset.format(second.start));
  });

  it("clips an incident to the hour it overlaps", () => {
    const result = measureStatus([{ label: "Feed", outages: [outage(START - 20 * MINUTE, START + 10 * MINUTE)] }], [HOUR], HOUR.end, START - HOUR_MS);
    expect(result.bars[0]).toMatchObject({ level: "major", longest: 10 * MINUTE, affected: 1, observedMs: HOUR_MS });
    expect(result.bars[0]?.incidents[0]?.ms).toBe(10 * MINUTE);
    expect(result.uptime).toBeCloseTo(50 / 60);
  });

  it("does not double-count overlapping outage intervals", () => {
    const result = measureStatus([{ label: "Feed", outages: [outage(START + 5 * MINUTE, START + 25 * MINUTE), outage(START + 15 * MINUTE, START + 35 * MINUTE)] }], [HOUR], HOUR.end, START);
    expect(result.uptime).toBe(0.5);
    expect(result.bars[0]?.longest).toBe(30 * MINUTE);
    expect(result.bars[0]?.affected).toBe(1);
  });

  it("can show a fully affected hour as red rather than using a six-hour threshold", () => {
    const result = measureStatus([{ label: "Feed", outages: [outage(START, HOUR.end)] }], [HOUR], HOUR.end, START);
    expect(result.bars[0]?.level).toBe("severe");
    expect(result.uptime).toBe(0);
  });

  it("shows partial publisher impact rather than claiming all datasets are unavailable", () => {
    const result = measureStatus([{ label: "Failing", outages: [outage(START, HOUR.end)] }, { label: "Healthy", outages: [] }], [HOUR], HOUR.end, START);
    expect(result.bars[0]).toMatchObject({ level: "major", affected: 1, trackedMembers: 2 });
    expect(result.uptime).toBe(0.5);
  });

  it("does not count the unelapsed part of the current hour as healthy", () => {
    const result = measureStatus([{ label: "Feed", outages: [outage(START)] }], [HOUR], START + 15 * MINUTE, START);
    expect(result.bars[0]).toMatchObject({ level: "severe", observedMs: 15 * MINUTE, longest: 15 * MINUTE });
    expect(result.uptime).toBe(0);
  });

  it("marks time before a feed existed as unknown and excludes it from the percentage", () => {
    const hours = [{ start: START - HOUR_MS, end: START }, HOUR];
    const result = measureStatus([{ label: "New feed", since: START, outages: [outage(START)] }], hours, HOUR.end, START - 4 * HOUR_MS);
    expect(result.bars.map((bar) => bar.level)).toEqual(["none", "severe"]);
    expect(result.uptime).toBe(0);
  });

  it("clips an ongoing incident to both tracking start and the visible range", () => {
    const result = measureStatus([{ label: "Feed", outages: [outage(START - 10 * HOUR_MS)] }], [HOUR], HOUR.end, START + 20 * MINUTE);
    expect(result.bars[0]).toMatchObject({ level: "severe", observedMs: 40 * MINUTE, longest: 40 * MINUTE });
    expect(result.uptime).toBe(0);
  });

  it("has no green or percentage before tracking begins", () => {
    const result = measureStatus([{ label: "Feed", outages: [] }], [HOUR], START + 15 * MINUTE, START + 15 * MINUTE);
    expect(result.bars[0]?.level).toBe("none");
    expect(result.uptime).toBeNull();
  });

  it("counts separate datasets even when their display names match", () => {
    const result = measureStatus([{ label: "Same title", outages: [outage(START)] }, { label: "Same title", outages: [outage(START)] }], [HOUR], HOUR.end, START);
    expect(result.bars[0]).toMatchObject({ affected: 2, trackedMembers: 2, level: "severe" });
  });
});
