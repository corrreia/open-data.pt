# The site's words

Every page is in English at its usual address and in European Portuguese under `/pt/`. The kernel serves both from the same build: it strips `/pt`, serves the same file, and rewrites its `lang`, title, description and preview tags (`apps/kernel/src/pages/page-meta.ts`). The page reads its language from the address (`src/lib/locale.ts`).

Each part of the site keeps its words in a file here, English and Portuguese side by side:

```ts
export const CATALOG_PAGE = inLocale({
  en: { heading: "Catalog", count: (n: number) => (n === 1 ? "1 dataset" : `${fmt.int(n)} datasets`) },
  pt: { heading: "Catálogo", count: (n: number) => (n === 1 ? "1 conjunto de dados" : `${fmt.int(n)} conjuntos de dados`) },
});
```

`inLocale` returns this page's half. The Portuguese has to have every key the English has, with the same parameters, or the type check fails. A phrase that takes a value is a function; one that wraps a link or other markup takes it as a `ReactNode` and lives in a `.tsx` file.

Links to the site's own pages go through `localHref("/catalog/")`, so a Portuguese page links to Portuguese pages. `/docs`, `/api/…`, `/openapi.json`, `/llms.txt` and other sites stay as they are.

Numbers and dates go through `fmt` (`src/lib/format.ts`) or an `Intl` formatter built with `INTL_LOCALE`, never with `undefined` or a fixed `"en-GB"`.

## What stays in English

- What agents read: the Markdown pages, `llms.txt`, the MCP server, the WebMCP tool descriptions, `/docs`.
- What the API sends: the publishers' own titles, descriptions and field names, error details from the server.
- Code, commands, API paths, field names, units and format names (GTFS, ArcGIS, CKAN).

## Writing Portuguese

European Portuguese, after the 1990 spelling agreement: _atual_, _ação_, _eletricidade_, _direção_. Never Brazilian forms: _ficheiro_ not _arquivo_, _ecrã_ not _tela_, _utilizador_ not _usuário_, _registo_ not _registro_, _transferir_ not _baixar_, _ligação_ not _link_ for a hyperlink in running text.

Address the reader without _você_: the third person and the formal imperative (_Escolha um tema_, _Tente de novo_, _Pode usar a API sem chave_). Labels and buttons are infinitives or nouns (_Pesquisar_, _Transferir CSV_).

A publisher's name can be masculine or feminine (_a_ DGEG, _o_ IPMA, _a_ Carris), so never put an article or a contraction before one: write _publicado por DGEG_, _dados de: IPMA_, or rephrase, never _da DGEG_. The site is masculine: _o open-data.pt_.

Portuguese runs about a quarter longer than English. Check a translated page at phone width.

## Glossary

| English                                | Português                              |
| -------------------------------------- | -------------------------------------- |
| dataset, product                       | conjunto de dados                      |
| table                                  | tabela                                 |
| series, time series                    | série, série temporal                  |
| record, row                            | registo, linha                         |
| field, column                          | campo, coluna                          |
| schema                                 | esquema                                |
| publisher                              | entidade publicadora (short: entidade) |
| feed (what we read on a schedule)      | fonte                                  |
| source (where the publisher serves it) | origem                                 |
| collection, run, acquisition           | recolha                                |
| catalog                                | catálogo                               |
| licence                                | licença                                |
| topic                                  | tema                                   |
| kind of data (role)                    | tipo de dados                          |
| status                                 | estado                                 |
| uptime                                 | disponibilidade                        |
| outage                                 | falha                                  |
| history                                | histórico                              |
| change, correction                     | alteração, correção                    |
| late, stale                            | atrasado                               |
| current, fresh                         | em dia                                 |
| how often, cadence                     | frequência                             |
| download                               | transferir                             |
| file                                   | ficheiro                               |
| link                                   | ligação                                |
| search, filter                         | pesquisar, filtrar                     |
| request (HTTP)                         | pedido                                 |
| key (API)                              | chave                                  |
| sign in                                | iniciar sessão                         |
| map, chart                             | mapa, gráfico                          |
| Start here                             | Começar                                |
| Analytics                              | Estatísticas                           |
| Contribute                             | Contribuir                             |
| Acceptable use                         | Utilização aceitável                   |
