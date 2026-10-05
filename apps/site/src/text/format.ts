import { inLocale } from "../lib/locale";

/** The words around numbers and times: how long ago, how often, how long. */
export const FORMAT = inLocale({
  en: {
    justNow: "just now",
    notScheduled: "not scheduled",
    dueNow: "due now",
    in: (amount: string) => `in ${amount}`,
    everyUnit: (amount: string) => `every ${amount}`,
    everyMinute: "every minute",
    everyHour: "every hour",
    daily: "daily",
    everyDays: (days: number) => `every ${days} days`,
    keptIndefinitely: "kept indefinitely",
    days: (days: number) => `${days} ${days === 1 ? "day" : "days"}`,
    underAMinute: "under a minute",
    yes: "true",
    no: "false",
  },
  pt: {
    justNow: "agora mesmo",
    notScheduled: "sem agendamento",
    dueNow: "agora",
    in: (amount: string) => `daqui a ${amount}`,
    everyUnit: (amount: string) => `a cada ${amount}`,
    everyMinute: "a cada minuto",
    everyHour: "de hora a hora",
    daily: "diariamente",
    everyDays: (days: number) => `a cada ${days} dias`,
    keptIndefinitely: "guardado sem prazo",
    days: (days: number) => `${days} ${days === 1 ? "dia" : "dias"}`,
    underAMinute: "menos de um minuto",
    yes: "verdadeiro",
    no: "falso",
  },
});
