import { inLocale } from "../lib/locale";

/** The search palette every page opens with ⌘K. */
export const SEARCH = inLocale({
  en: {
    pages: {
      catalog: { title: "Catalog", detail: "Every dataset, with filters" },
      publishers: { title: "Publishers", detail: "Who publishes the data" },
      licences: { title: "Licences", detail: "The terms the data is served under" },
      status: { title: "Status", detail: "Is everything being collected" },
      start: { title: "Start here", detail: "Use the API in three requests" },
      operations: { title: "Operations", detail: "Every feed, run and rule" },
      contribute: { title: "Contribute", detail: "Suggest a source, add a dataset, report a problem" },
    },
    groups: { listings: "Tables and series", publishers: "Publishers", pages: "Pages" },
    inputLabel: "Search datasets, publishers and pages",
    placeholder: "Search datasets, publishers and pages…",
    failed: (message: string) => `Could not load the catalog (${message}). Datasets and publishers are missing from these results; close the search and open it again to retry.`,
    noPageEither: "No page matches that search either.",
    loading: "Loading the catalog…",
    noMatch: (search: string) => `No dataset, publisher or page matches “${search}”.`,
    move: "Move",
    open: "Open",
    close: "Close",
  },
  pt: {
    pages: {
      catalog: { title: "Catálogo", detail: "Todos os conjuntos de dados, com filtros" },
      publishers: { title: "Entidades publicadoras", detail: "Quem publica os dados" },
      licences: { title: "Licenças", detail: "Os termos em que os dados são servidos" },
      status: { title: "Estado", detail: "Está tudo a ser recolhido?" },
      start: { title: "Começar", detail: "Usar a API em três pedidos" },
      operations: { title: "Operações", detail: "Todas as fontes, recolhas e regras" },
      contribute: { title: "Contribuir", detail: "Sugerir uma fonte, acrescentar dados, avisar de um problema" },
    },
    groups: { listings: "Tabelas e séries", publishers: "Entidades publicadoras", pages: "Páginas" },
    inputLabel: "Pesquisar conjuntos de dados, entidades publicadoras e páginas",
    placeholder: "Pesquisar dados, entidades e páginas…",
    failed: (message: string) =>
      `Não foi possível carregar o catálogo (${message}). Faltam conjuntos de dados e entidades nestes resultados; feche a pesquisa e volte a abri-la para tentar de novo.`,
    noPageEither: "Também nenhuma página corresponde a essa pesquisa.",
    loading: "A carregar o catálogo…",
    noMatch: (search: string) => `Nenhum conjunto de dados, entidade ou página corresponde a “${search}”.`,
    move: "Mover",
    open: "Abrir",
    close: "Fechar",
  },
});
