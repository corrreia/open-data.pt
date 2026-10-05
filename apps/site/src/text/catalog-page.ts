import { fmt } from "../lib/format";
import { inLocale } from "../lib/locale";
import { LISTINGS } from "./listings";

/** The catalog page: its filters, its search and its order. */
export const CATALOG_PAGE = inLocale({
  en: {
    facets: {
      topic: "Topic",
      publisher: "Publisher",
      licence: "Licence",
      kind: "Kind of data",
      updates: "Updates",
      format: "How it is published",
    },
    sorts: { publisher: "Grouped by publisher", recent: "Recently updated first", name: "By name" },
    showAll: (count: number) => `Show all ${fmt.int(count)}`,
    eyebrow: "Catalog",
    title: "Every dataset, and who publishes it",
    intro:
      "Filter by topic, publisher, kind of data, how often it changes, or how the publisher shares it. Every table and series keeps its publisher’s licence and links back to their source.",
    filtersLabel: "Filters",
    hideFilters: "Hide filters",
    filters: (active: number) => `Filters${active ? ` (${active})` : ""}`,
    searchPlaceholder: "Search tables, series and publishers…",
    searchLabel: "Search the catalog",
    order: "Order",
    loading: "Loading the catalog…",
    shown: (visible: number, total: number) => `${LISTINGS.count(visible)}${visible !== total ? `, of ${fmt.int(total)}` : ""}`,
    removeFilter: (name: string) => `Remove filter ${name}`,
    clearAll: "Clear all",
    errorWhat: "the catalog",
    loadingLabel: "Loading the catalog",
    nothingMatches: "Nothing matches",
    tryAnother: "Try another word, or remove a filter.",
    clearSearchAndFilters: "Clear search and filters",
  },
  pt: {
    facets: {
      topic: "Tema",
      publisher: "Entidade publicadora",
      licence: "Licença",
      kind: "Tipo de dados",
      updates: "Atualizações",
      format: "Forma de publicação",
    },
    sorts: { publisher: "Por entidade publicadora", recent: "Mais recentes primeiro", name: "Por nome" },
    showAll: (count: number) => `Mostrar as ${fmt.int(count)} opções`,
    eyebrow: "Catálogo",
    title: "Todos os conjuntos de dados, e quem os publica",
    intro:
      "Filtre por tema, entidade publicadora, tipo de dados, frequência de atualização ou forma de publicação. Cada tabela e série mantém a licença da entidade que a publica e tem uma ligação para a origem.",
    filtersLabel: "Filtros",
    hideFilters: "Esconder filtros",
    filters: (active: number) => `Filtros${active ? ` (${active})` : ""}`,
    searchPlaceholder: "Pesquisar tabelas, séries e entidades…",
    searchLabel: "Pesquisar no catálogo",
    order: "Ordem",
    loading: "A carregar o catálogo…",
    shown: (visible: number, total: number) => `${LISTINGS.count(visible)}${visible !== total ? `, de ${fmt.int(total)}` : ""}`,
    removeFilter: (name: string) => `Remover o filtro ${name}`,
    clearAll: "Limpar tudo",
    errorWhat: "o catálogo",
    loadingLabel: "A carregar o catálogo",
    nothingMatches: "Nenhum resultado",
    tryAnother: "Experimente outra palavra ou retire um filtro.",
    clearSearchAndFilters: "Limpar a pesquisa e os filtros",
  },
});
