/** The few helpers every section builds its piece of the page with. */

/** An element with a class and its children; text is added as text, never as markup. */
export function el<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className: string, ...children: (Node | string)[]): HTMLElementTagNameMap[Tag] {
  const made = document.createElement(tag);
  if (className !== "") made.className = className;
  made.append(...children);
  return made;
}

const DAY = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long" });
const SHORT_DAY = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "numeric" });
const HOUR = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
const WHEN = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const NUMBER = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });

/** A calendar date as IPMA writes it, `2026-11-11`, read as that day in Lisbon. */
const noon = (date: string): Date => new Date(`${date}T12:00:00Z`);

export const format = {
  /** "quarta-feira, 11 de novembro", or "hoje" and "amanhã" when that is what it is. */
  day(date: string, today: string): string {
    const days = Math.round((noon(date).getTime() - noon(today).getTime()) / 86_400_000);
    return days === 0 ? "Hoje" : days === 1 ? "Amanhã" : DAY.format(noon(date));
  },
  shortDay: (date: string): string => SHORT_DAY.format(noon(date)),
  hour: (time: string): string => HOUR.format(new Date(time)),
  when: (time: string): string => WHEN.format(new Date(time)),
  number: (value: number): string => NUMBER.format(value),
  /** A value with its unit, or a dash when there is none. */
  measure: (value: number | null | undefined, unit: string): string => (value === null || value === undefined ? "–" : `${NUMBER.format(value)} ${unit}`),
};

/** Today's date in Lisbon, as IPMA writes dates. */
export function lisbonToday(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(new Date());
}

/** A row of buttons of which one is chosen. Choosing calls back with its key. */
export function choice(label: string, options: readonly (readonly [key: string, text: string])[], chosen: string, onChoose: (key: string) => void): HTMLElement {
  const group = el("div", "choice");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  for (const [key, text] of options) {
    const button = el("button", "", text);
    button.type = "button";
    button.setAttribute("aria-pressed", String(key === chosen));
    button.addEventListener("click", () => {
      for (const other of group.children) other.setAttribute("aria-pressed", String(other === button));
      onChoose(key);
    });
    group.append(button);
  }
  return group;
}

/** The eight compass points IPMA names a direction by, in degrees clockwise from north. */
export const COMPASS = new Map([
  ["N", 0],
  ["NE", 45],
  ["E", 90],
  ["SE", 135],
  ["S", 180],
  ["SW", 225],
  ["W", 270],
  ["NW", 315],
]);

/** An arrow pointing where something that comes from a compass point is going. */
export function arrowFrom(compassPoint: string | null): SVGSVGElement | undefined {
  const from = COMPASS.get(compassPoint ?? "");
  if (from === undefined) return undefined;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "arrow");
  svg.style.transform = `rotate(${from + 180}deg)`;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8 1.5l4.2 5.5H9.2v7.5H6.8V7H3.8z");
  svg.append(path);
  return svg;
}
