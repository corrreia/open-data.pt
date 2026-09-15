// Lisbon calendar periods, as the summaries count them: days and months begin at Lisbon midnight.

import type { SummaryResolution } from "./types";

const clock = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Lisbon's wall-clock time at an instant, written as if it were UTC. */
function wallClock(instant: number) {
  const parts = clock.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((each) => each.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/** The UTC instant a Lisbon calendar day (YYYY-MM-DD) begins. Lisbon changes its clock at 01:00 UTC, never around midnight. */
function lisbonMidnight(day: string) {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  return utcMidnight - (wallClock(utcMidnight - 3_600_000) - (utcMidnight - 3_600_000));
}

/** The start, as an ISO instant, of the hour, Lisbon day or Lisbon month an instant falls in. */
export function periodStart(instant: number, resolution: SummaryResolution) {
  if (resolution === "hour") return new Date(Math.floor(instant / 3_600_000) * 3_600_000).toISOString();
  const day = new Date(wallClock(instant)).toISOString().slice(0, 10);
  return new Date(lisbonMidnight(resolution === "day" ? day : `${day.slice(0, 7)}-01`)).toISOString();
}
