// Lisbon calendar periods, as the summaries count them: days and months begin at Lisbon midnight.

import { lisbonDay, lisbonInstants } from "@open-data-pt/lisbon";

import type { SummaryResolution } from "./types";

/** The UTC instant a Lisbon calendar day (YYYY-MM-DD) begins. */
function lisbonMidnight(day: string): number {
  return lisbonInstants(day, "00:00")[0]?.getTime() ?? Date.parse(`${day}T00:00:00Z`);
}

/** The start, as an ISO instant, of the hour, Lisbon day or Lisbon month an instant falls in. */
export function periodStart(instant: number, resolution: SummaryResolution) {
  if (resolution === "hour") return new Date(Math.floor(instant / 3_600_000) * 3_600_000).toISOString();
  const day = lisbonDay(instant);
  return new Date(lisbonMidnight(resolution === "day" ? day : `${day.slice(0, 7)}-01`)).toISOString();
}
