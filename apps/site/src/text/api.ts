import { inLocale } from "../lib/locale";

/** What a failed read says when the server gave no reason of its own. */
export const API = inLocale({
  en: { requestFailed: (status: number) => `Request failed with HTTP ${status}` },
  pt: { requestFailed: (status: number) => `O pedido falhou com HTTP ${status}` },
});
