/**
 * Europe/Lisbon wall-clock arithmetic. Several Portuguese sources publish local
 * civil times with no offset, so the platform reads them here, once, without
 * ever consulting the runtime's own time zone.
 */
const LISBON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Minutes Lisbon's wall clock is ahead of UTC at the instant `milliseconds`. */
export function lisbonOffsetMinutes(milliseconds: number): number {
  const wall = wallMilliseconds(milliseconds);
  return Math.round((wall - Math.floor(milliseconds / 1000) * 1000) / 60_000);
}

/** The Europe/Lisbon calendar day of a moment, as YYYY-MM-DD: the calendar these sources publish against. */
export function lisbonDay(instant: string | number | Date): string {
  const parts = readParts(new Date(instant));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Every UTC instant a Europe/Lisbon wall-clock reading names, earliest first:
 * none in the hour the spring clock change skips, two in the hour the autumn
 * change repeats, and one for every other reading.
 */
export function lisbonInstants(day: string, time: string): Date[] {
  const wall = wallReading(day, time);
  if (wall === undefined) return [];
  const found: number[] = [];
  // Lisbon is never more than an hour from UTC, so probing an hour either side of the
  // reading taken as UTC reaches every instant the clock could be naming.
  for (const probe of [wall - 3_600_000, wall, wall + 3_600_000]) {
    const instant = wall - lisbonOffsetMinutes(probe) * 60_000;
    if (!found.includes(instant) && wallMilliseconds(instant) === wall) found.push(instant);
  }
  return found.sort((left, right) => left - right).map((instant) => new Date(instant));
}

/**
 * A Europe/Lisbon wall-clock reading as an ISO 8601 UTC time; undefined when
 * the clock never shows it. The repeated autumn hour reads as standard time,
 * the later of the two instants, which is how a source writing it after the
 * change means it.
 */
export function lisbonToUtc(day: string, time: string): string | undefined {
  return lisbonInstants(day, time).at(-1)?.toISOString();
}

/** A `YYYY-MM-DD` day and `HH:mm[:ss]` time read as if they were UTC; undefined for a reading no calendar shows. */
function wallReading(day: string, time: string): number | undefined {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(time);
  if (!date || !clock) return undefined;
  const [year, month, dayOfMonth] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const [hour, minute, second] = [Number(clock[1]), Number(clock[2]), Number(clock[3] ?? "0")];
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const reading = Date.UTC(year, month - 1, dayOfMonth, hour, minute, second);
  const check = new Date(reading);
  // Date.UTC rolls an impossible date forwards; a reading that moved was never a date.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth) return undefined;
  return reading;
}

/** The Lisbon wall clock at an instant, read back as if that wall clock were UTC. */
function wallMilliseconds(milliseconds: number): number {
  const parts = readParts(new Date(milliseconds));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

interface LisbonParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function readParts(date: Date): LisbonParts {
  const parts = LISBON.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}
