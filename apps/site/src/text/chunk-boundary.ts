import { inLocale } from "../lib/locale";

/** What a view that failed to load says. */
export const CHUNK_BOUNDARY = inLocale({
  en: {
    title: "This view could not load",
    description: "The site was probably updated since this page opened. Reload to get the current version.",
    reload: "Reload the page",
  },
  pt: {
    title: "Não foi possível carregar esta vista",
    description: "O site foi provavelmente atualizado depois de esta página abrir. Recarregue para obter a versão atual.",
    reload: "Recarregar a página",
  },
});
