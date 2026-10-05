import { fmt, plural } from "../lib/format";
import { inLocale } from "../lib/locale";

/** How the catalog's pages count and describe tables and series, shared by the home, catalog, publisher and licence pages. */
export const LISTINGS = inLocale({
  en: {
    tablesAndSeries: "Tables and series",
    count: (count: number) => plural(count, "table or series", "tables and series"),
    publishers: (count: number) => plural(count, "publisher"),
    tone: { ok: "Current", warn: "Late", bad: "Failing" },
    empty: "empty",
    points: "pts",
    rows: "rows",
    never: "never",
    searchInCatalog: "Search and filter in the catalog",
    more: (count: number) => ` · +${fmt.int(count)} more`,
  },
  pt: {
    tablesAndSeries: "Tabelas e séries",
    count: (count: number) => plural(count, "tabela ou série", "tabelas e séries"),
    publishers: (count: number) => plural(count, "entidade publicadora", "entidades publicadoras"),
    tone: { ok: "Em dia", warn: "Atrasado", bad: "Com falhas" },
    empty: "vazio",
    points: "pts",
    rows: "linhas",
    never: "nunca",
    searchInCatalog: "Pesquisar e filtrar no catálogo",
    more: (count: number) => ` · e mais ${fmt.int(count)}`,
  },
});
