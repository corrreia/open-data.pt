/** How the site writes dates, times and numbers: in Portuguese, on Lisbon's clock. */

const DAY = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long" });
const SHORT_DATE = new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", day: "numeric", month: "short" });
const HOUR = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
const WHEN = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const NOW = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const NUMBER = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });

/** A calendar date as IPMA writes it, `2026-11-11`, as an instant in the middle of that day. */
const noon = (date: string): Date => new Date(`${date}T12:00:00Z`);
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const format = {
  /** "Hoje", "Amanhã", or the day by name. */
  day(date: string, today: string): string {
    const days = Math.round((noon(date).getTime() - noon(today).getTime()) / 86_400_000);
    return days === 0 ? "Hoje" : days === 1 ? "Amanhã" : capital(DAY.format(noon(date)));
  },
  shortDate: (time: string): string => SHORT_DATE.format(new Date(time)),
  hour: (time: string): string => HOUR.format(new Date(time)),
  when: (time: string): string => WHEN.format(new Date(time)),
  now: (at: Date): string => capital(NOW.format(at)),
  number: (value: number): string => NUMBER.format(value),
  /** A value with its unit, held together on one line, or a dash when there is none. */
  measure: (value: number | null | undefined, unit: string): string => (value === null || value === undefined ? "–" : `${NUMBER.format(value)} ${unit}`),
  /** A range with its unit, as "2,4 a 3,3 m", with an en dash for none. */
  range: (low: number | null, high: number | null, unit: string): string =>
    low === null || high === null ? "–" : low === high ? `${NUMBER.format(low)} ${unit}` : `${NUMBER.format(low)} a ${NUMBER.format(high)} ${unit}`,
  degrees: (value: number | null): string => (value === null ? "–" : `${Math.round(value)}°`),
};

/** Today's date in Lisbon, as IPMA writes dates. */
export function lisbonToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(new Date());
}

/** The eight compass points IPMA names a direction by, in degrees clockwise from north, with their names. */
export const COMPASS = new Map([
  ["N", { degrees: 0, name: "norte" }],
  ["NE", { degrees: 45, name: "nordeste" }],
  ["E", { degrees: 90, name: "leste" }],
  ["SE", { degrees: 135, name: "sueste" }],
  ["S", { degrees: 180, name: "sul" }],
  ["SW", { degrees: 225, name: "sudoeste" }],
  ["W", { degrees: 270, name: "oeste" }],
  ["NW", { degrees: 315, name: "noroeste" }],
]);
