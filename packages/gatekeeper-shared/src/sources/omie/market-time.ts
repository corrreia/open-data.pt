/** First market day published with separate Spanish and Portuguese prices. */
export const OMIE_HISTORY_EARLIEST_MARKET_DATE = "2007-07-01";

/** OMIE changed the day-ahead market from hourly to 15-minute periods on this day. */
export const OMIE_QUARTER_HOURLY_START = "2025-10-01";

/** Convert one 1-based OMIE market period to its physical UTC start. */
export function marketPeriodStart(date: string, period: number): string {
  const parts = parseMarketDate(date);
  if (!parts || !Number.isInteger(period)) {
    throw new Error(`Invalid OMIE market period ${date} #${period}`);
  }
  const minutes = date >= OMIE_QUARTER_HOURLY_START ? 15 : 60;
  const start = madridMidnightUtc(parts.year, parts.month, parts.day);
  const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const next = madridMidnightUtc(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
  );
  const periodCount = (next - start) / (minutes * 60_000);
  if (period < 1 || period > periodCount) {
    throw new Error(
      `Invalid OMIE market period ${date} #${period}; expected 1-${periodCount}`,
    );
  }
  return new Date(start + (period - 1) * minutes * 60_000).toISOString();
}

/** The complete market day immediately before an exclusive UTC cursor. */
export function marketDateBefore(before: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(before);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function shiftMarketDate(date: string, days: number): string {
  const parts = parseMarketDate(date);
  if (!parts) throw new Error(`Invalid OMIE market date ${date}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
    .toISOString()
    .slice(0, 10);
}

export function parseMarketDate(
  value: string,
): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

function madridMidnightUtc(year: number, month: number, day: number): number {
  const offsetHours = madridOffsetAtLocalMidnight(year, month, day);
  return Date.UTC(year, month - 1, day) - offsetHours * 3_600_000;
}

function madridOffsetAtLocalMidnight(
  year: number,
  month: number,
  day: number,
): 1 | 2 {
  if (month < 3 || month > 10) return 1;
  if (month > 3 && month < 10) return 2;
  if (month === 3) return day > lastSunday(year, 3) ? 2 : 1;
  return day <= lastSunday(year, 10) ? 2 : 1;
}

function lastSunday(year: number, month: 3 | 10): number {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
}
