import type { Outage } from "./types";

export const STATUS_DAYS = 3;
export const STATUS_HOURS = STATUS_DAYS * 24;
export const HOUR_MS = 3_600_000;

export type StatusLevel = "ok" | "major" | "severe" | "none";

export interface StatusHour {
  start: number;
  end: number;
}

export interface StatusIncident {
  label: string;
  outage: Outage;
  ms: number;
}

export interface StatusBar {
  hour: StatusHour;
  level: StatusLevel;
  longest: number;
  affected: number;
  trackedMembers: number;
  observedMs: number;
  incidents: StatusIncident[];
}

export interface StatusMeasurement {
  bars: StatusBar[];
  uptime: number | null;
}

export interface StatusMember {
  label: string;
  outages: Outage[];
  /** A feed cannot have known collection health before it existed. */
  since?: number;
}

/** Previous 71 clock hours and the current partial hour, oldest first. */
export function statusHours(now: number): StatusHour[] {
  const current = Math.floor(now / HOUR_MS) * HOUR_MS;
  return Array.from({ length: STATUS_HOURS }, (_, index) => {
    // Absolute-duration steps remain exactly one hour through timezone/DST changes.
    const start = current - (STATUS_HOURS - 1 - index) * HOUR_MS;
    return { start, end: start + HOUR_MS };
  });
}

export function outageSpan(outage: Outage, now: number): [number, number] {
  return [Date.parse(outage.startedAt), outage.endedAt ? Date.parse(outage.endedAt) : now];
}

/** Union intervals so overlapping reports never count the same member-minute twice. */
function unavailableTime(spans: Array<[number, number]>): number {
  spans.sort((left, right) => left[0] - right[0]);
  let total = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [start, until] of spans) {
    total += Math.max(0, until - Math.max(start, end));
    end = Math.max(end, until);
  }
  return total;
}

/**
 * Recorded collection-incident time, not independent publisher website uptime.
 * Unknown time and the unelapsed part of the current hour are never counted as healthy.
 */
export function measureStatus(members: StatusMember[], hours: StatusHour[], now: number, tracked: number): StatusMeasurement {
  let totalObserved = 0;
  let totalUnavailable = 0;
  const bars = hours.map((hour): StatusBar => {
    let observed = 0;
    let unavailable = 0;
    let longest = 0;
    let affected = 0;
    let trackedMembers = 0;
    let observedMs = 0;
    const incidents: StatusIncident[] = [];
    for (const member of members) {
      const memberStart = member.since !== undefined && Number.isFinite(member.since) ? member.since : tracked;
      const from = Math.max(hour.start, tracked, memberStart);
      const to = Math.min(hour.end, now);
      if (to <= from) continue;
      const duration = to - from;
      trackedMembers += 1;
      observed += duration;
      observedMs = Math.max(observedMs, duration);
      const spans: Array<[number, number]> = [];
      for (const outage of member.outages) {
        const [start, end] = outageSpan(outage, now);
        const clipped: [number, number] = [Math.max(start, from), Math.min(end, to)];
        const ms = clipped[1] - clipped[0];
        if (ms <= 0 || !Number.isFinite(ms)) continue;
        spans.push(clipped);
        incidents.push({ label: member.label, outage, ms });
      }
      const down = unavailableTime(spans);
      if (down > 0) affected += 1;
      longest = Math.max(longest, down);
      unavailable += down;
    }
    totalObserved += observed;
    totalUnavailable += unavailable;
    const level: StatusLevel = observed === 0 ? "none" : unavailable === 0 ? "ok" : unavailable >= observed ? "severe" : "major";
    return { hour, level, longest, affected, trackedMembers, observedMs, incidents };
  });
  return { bars, uptime: totalObserved > 0 ? Math.max(0, 1 - totalUnavailable / totalObserved) : null };
}
