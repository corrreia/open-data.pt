import { inLocale } from "../lib/locale";

/** The small pieces many pages share. */
export const COMMON = inLocale({
  en: {
    couldNotLoad: (what: string) => `Could not load ${what}.`,
    this: "this",
    tryAgainOrReload: "Try again, or reload the page.",
    reloadToTryAgain: "Reload the page to try again.",
    tryAgain: "Try again",
  },
  pt: {
    couldNotLoad: (what: string) => `Não foi possível carregar ${what}.`,
    this: "isto",
    tryAgainOrReload: "Tente de novo ou recarregue a página.",
    reloadToTryAgain: "Recarregue a página para tentar de novo.",
    tryAgain: "Tentar de novo",
  },
});
