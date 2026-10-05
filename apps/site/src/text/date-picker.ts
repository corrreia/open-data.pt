import { INTL_LOCALE, inLocale } from "../lib/locale";

const caption = new Intl.DateTimeFormat(INTL_LOCALE, { month: "long", year: "numeric" });
const weekday = new Intl.DateTimeFormat(INTL_LOCALE, { weekday: "short" });
const fullDate = new Intl.DateTimeFormat(INTL_LOCALE, { dateStyle: "full" });

/** The date picker's words: the calendar's month and weekday names, and what a screen reader hears. */
export const DATE_PICKER = {
  /** Portugal's weeks start on Monday. */
  weekStartsOn: inLocale<1 | undefined>({ en: undefined, pt: 1 }),
  formatters: {
    formatCaption: (month: Date) => caption.format(month),
    formatWeekdayName: (day: Date) => weekday.format(day),
  },
  labels: inLocale({
    en: {
      labelNav: () => "Navigation bar",
      labelPrevious: () => "Go to the previous month",
      labelNext: () => "Go to the next month",
      labelGrid: (month: Date) => caption.format(month),
      labelDayButton: (date: Date, modifiers?: { selected?: boolean; today?: boolean }) =>
        `${modifiers?.today ? "Today, " : ""}${fullDate.format(date)}${modifiers?.selected ? ", selected" : ""}`,
    },
    pt: {
      labelNav: () => "Barra de navegação",
      labelPrevious: () => "Ir para o mês anterior",
      labelNext: () => "Ir para o mês seguinte",
      labelGrid: (month: Date) => caption.format(month),
      labelDayButton: (date: Date, modifiers?: { selected?: boolean; today?: boolean }) =>
        `${modifiers?.today ? "Hoje, " : ""}${fullDate.format(date)}${modifiers?.selected ? ", selecionado" : ""}`,
    },
  }),
};
