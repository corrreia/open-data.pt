import type { ReactNode } from "react";
import { fmt } from "../lib/format";
import { inLocale } from "../lib/locale";

/** What the start page's prose needs from the page: its pieces of markup, given their words here. */
export interface StartPieces {
  code: (text: string) => ReactNode;
  link: (href: string, text: string) => ReactNode;
}

interface Lead {
  lead: string;
  body: (pieces: StartPieces) => ReactNode;
}

interface EntryPointText {
  title: string;
  description: string;
}

interface StartText {
  /** What a reader pastes into their assistant so it connects the server itself, whatever app it runs in. */
  setupPrompt: (url: string) => string;
  sections: { threeRequests: string; mcp: string; kinds: string; history: string; etiquette: string; everyWayIn: string };
  pledges: { free: Lead; noKey: Lead; credited: Lead; machine: Lead };
  reads: { records: string; currentRecords: string; applicableHistory: string; durableRevisions: string; hotWindow: string; durableRanges: string };
  history: { events: string; changes: string; series: string };
  manners: Lead[];
  entryPoints: {
    products: EntryPointText;
    mcp: EntryPointText;
    openapi: EntryPointText;
    llms: EntryPointText;
    dcat: EntryPointText;
    feeds: EntryPointText;
    health: EntryPointText;
  };
  copied: string;
  copyPrompt: string;
  promptCopied: string;
  eyebrow: string;
  title: (emphasis: (text: string) => ReactNode) => ReactNode;
  intro: string;
  pledgesLabel: string;
  threeRequestsEyebrow: string;
  threeRequestsTitle: string;
  productIntro: (pieces: StartPieces) => ReactNode;
  listProducts: string;
  listNote: (count: string | undefined) => string;
  readRecords: string;
  recordsNote: (pieces: StartPieces) => ReactNode;
  readSeries: string;
  seriesNote: (pieces: StartPieces) => ReactNode;
  productPage: (pieces: StartPieces, example: ReactNode) => ReactNode;
  mcpEyebrow: string;
  mcpTitle: string;
  mcpIntro: (pieces: StartPieces) => ReactNode;
  copyMcpAddress: string;
  kindsEyebrow: string;
  kindsTitle: string;
  kindsIntro: (pieces: StartPieces) => ReactNode;
  products: (count: number) => string;
  historyEyebrow: string;
  historyTitle: string;
  historyIntro: string;
  historyCursors: string;
  readYear: string;
  historyCache: string;
  etiquetteEyebrow: string;
  etiquetteTitle: string;
  everyWayInEyebrow: string;
  everyWayInTitle: string;
  copyAddress: (title: string) => string;
  open: string;
  onThisPage: string;
}

export const START = inLocale<StartText>({
  en: {
    setupPrompt: (url) => `Connect the open-data.pt MCP server to this assistant.

- Address: ${url}
- Transport: Streamable HTTP (a remote server; no API key, no sign-in)
- Name: open-data-pt

Add it to the MCP settings of the app you are running in. In Claude Code that is:
claude mcp add --transport http open-data-pt ${url}

Then tell me whether I need to restart or reload for it to appear. Once connected, its search and execute tools read free Portuguese public data.`,
    sections: {
      threeRequests: "Three requests",
      mcp: "AI assistants (MCP)",
      kinds: "Five kinds of product",
      history: "Where the past lives",
      etiquette: "Limits and manners",
      everyWayIn: "Every way in",
    },
    pledges: {
      free: { lead: "Free.", body: () => "Reads cost nothing and never will. The platform runs on a hobby budget by design." },
      noKey: {
        lead: "No key.",
        body: ({ code }) => (
          <>The whole API is open and read-only; there is nothing to write. Requests are rate limited per client, and a {code("429")} response says when to retry.</>
        ),
      },
      credited: { lead: "Credited.", body: () => "Each dataset carries the licence and attribution of its publisher." },
      machine: {
        lead: "Machine first.",
        body: ({ link }) => (
          <>
            JSON everywhere, CORS on, OpenAPI 3.1, DCAT 3, an {link("#mcp", "MCP server")} and a plain-text {link("/llms.txt", "llms.txt")}.
          </>
        ),
      },
    },
    reads: {
      records: "Records",
      currentRecords: "Current records",
      applicableHistory: "Applicable history",
      durableRevisions: "Durable revisions",
      hotWindow: "The hot window",
      durableRanges: "Durable ranges",
    },
    history: {
      events: "The applicable known revision of each event in the interval.",
      changes: "Durable corrections and retractions in knowledge-time order.",
      series: "Deduplicated time-series points.",
    },
    manners: [
      { lead: "Use bounded ranges.", body: () => "Historical endpoints require a UTC interval of at most 366 days and are cached at the edge." },
      {
        lead: "Poll at the product’s cadence.",
        body: () => "Each product page says how often its feed runs. Near-real-time products refresh every one to five minutes, most others hourly or daily.",
      },
      {
        lead: "Page deterministically.",
        body: ({ code }) => <>Follow each endpoint’s opaque {code("nextCursor")} until it is null; equal timestamps are safe.</>,
      },
      { lead: "Attribute the publisher,", body: () => "not this site. The data is theirs; this site preserves and serves it." },
      {
        lead: "Read the product metadata first.",
        body: ({ code }) => (
          <>
            {code("GET /api/products/{slug}")} carries the schema, unit, row count, watermark and whether the product is stale, so you know what the rows mean before you fetch
            them.
          </>
        ),
      },
      {
        lead: "Something wrong?",
        body: ({ link }) => (
          <>
            The {link("/status/", "status page")} shows collection hour by hour over the last three days, and {link("/operations/#activity", "operations")} shows every run,
            including the failed ones, with a day picker to look at any past day.
          </>
        ),
      },
    ],
    entryPoints: {
      products: { title: "Product list", description: "Every product with role, schema, counts and freshness. Start here." },
      mcp: { title: "MCP server", description: "For AI assistants. Streamable HTTP, no key." },
      openapi: { title: "OpenAPI 3.1", description: "The exact contract for every endpoint, including parameters and error formats." },
      llms: { title: "llms.txt", description: "A plain-text guide for language models: what exists, how to call it, what to avoid." },
      dcat: { title: "DCAT 3 catalog", description: "JSON-LD dataset entries with licence, attribution, publisher and distribution URLs." },
      feeds: { title: "Feeds", description: "Every collection job: its source, cadence, last run and next run. Read-only." },
      health: { title: "Health", description: "A single JSON status for uptime checks." },
    },
    copied: "Copied",
    copyPrompt: "Copy the setup prompt",
    promptCopied: "Setup prompt copied",
    eyebrow: "Start here",
    title: (emphasis) => <>Free, keyless, {emphasis("meant to stay that way")}.</>,
    intro:
      "open-data.pt collects Portuguese public data from the institutions that publish it and serves it as clean JSON. There is no account, no API key, no quota to buy, and no plan to add one. Use it from a script, a notebook, a spreadsheet, or any tool that speaks HTTP.",
    pledgesLabel: "What you can count on",
    threeRequestsEyebrow: "Three requests",
    threeRequestsTitle: "Everything starts from the product list",
    productIntro: ({ code }) => (
      <>
        A <strong>product</strong> is one table you can read: current records, a time series, an event log, or a summary. On the site, a dataset holds one or more products: each
        table or series inside a dataset is a product. List them, pick one by its {code("slug")}, then read its rows. Every response is JSON with a {code("data")} array.
      </>
    ),
    listProducts: "List the products",
    listNote: (count) =>
      `Returns every product with its role, schema, row count, watermark and freshness. ${count ? `${count} today` : "About 200 today"}. Cached for 20 seconds at the edge.`,
    readRecords: "Read a product’s current records",
    recordsNote: ({ code }) => (
      <>
        Follow {code("nextCursor")} for the next page. Add {code("validAt=<ISO time>")} for what was valid then; earlier versions live in the history endpoints.
      </>
    ),
    readSeries: "Read a time series",
    seriesNote: ({ code }) => <>Newest points first. The rolling window holds the last 5,000 points; use the bounded {code("/series/range")} endpoint for durable history.</>,
    productPage: ({ code }, example) => (
      <>
        Every product also has a page for humans at {code("/product/?slug=<slug>")} with a chart or table, the schema, the lineage of the run that built it, and copyable API links
        {example ? <>, such as {example}</> : null}.
      </>
    ),
    mcpEyebrow: "AI assistants",
    mcpTitle: "Query the data from an AI assistant",
    mcpIntro: ({ link }) => (
      <>
        The API is also an <strong>MCP server</strong>, built on Cloudflare’s {link("https://blog.cloudflare.com/code-mode/", "Code Mode")}. Copy its address into your MCP client,
        or copy the setup prompt and paste it into your assistant. No key needed.
      </>
    ),
    copyMcpAddress: "Copy the MCP server address",
    kindsEyebrow: "Shapes",
    kindsTitle: "Five kinds of product, one rule each",
    kindsIntro: ({ code }) => <>The {code("role")} field on a product tells you how it changes and what history you get.</>,
    products: (count) => (count === 1 ? "1 product" : `${fmt.int(count)} products`),
    historyEyebrow: "History",
    historyTitle: "Where the past lives",
    historyIntro:
      "The fast endpoints serve a rolling window: the current version of each product plus a bounded set of recent points and changes. Every meaningful revision is appended to a lake of Parquet tables and stays there. Typed, bounded endpoints expose it:",
    historyCursors: "All three use opaque compound cursors and include freshness and coverage.",
    readYear: "Read a year of a time series",
    historyCache: "Windows that ended over an hour ago are cached for a day; others for five minutes.",
    etiquetteEyebrow: "Etiquette",
    etiquetteTitle: "Limits and manners",
    everyWayInEyebrow: "Machine-readable",
    everyWayInTitle: "Every way in",
    copyAddress: (title) => `Copy the ${title} address`,
    open: "Open",
    onThisPage: "On this page",
  },
  pt: {
    setupPrompt: (url) => `Liga o servidor MCP do open-data.pt a este assistente.

- Endereço: ${url}
- Transporte: Streamable HTTP (um servidor remoto; sem chave de API, sem iniciar sessão)
- Nome: open-data-pt

Acrescenta-o às definições de MCP da aplicação em que estás a correr. No Claude Code é:
claude mcp add --transport http open-data-pt ${url}

Depois diz-me se preciso de reiniciar ou recarregar para que apareça. Depois de ligado, as ferramentas search e execute leem dados públicos portugueses gratuitos.`,
    sections: {
      threeRequests: "Três pedidos",
      mcp: "Assistentes de IA (MCP)",
      kinds: "Cinco tipos de produto",
      history: "Onde fica o passado",
      etiquette: "Limites e boas maneiras",
      everyWayIn: "Todas as entradas",
    },
    pledges: {
      free: { lead: "Gratuito.", body: () => "Ler não custa nada e nunca custará. A plataforma corre, de propósito, com um orçamento de passatempo." },
      noKey: {
        lead: "Sem chave.",
        body: ({ code }) => (
          <>
            A API é toda aberta e só de leitura; não há nada para escrever. Os pedidos têm um limite de ritmo por cliente, e uma resposta {code("429")} diz quando tentar de novo.
          </>
        ),
      },
      credited: { lead: "Com créditos.", body: () => "Cada conjunto de dados traz a licença e a atribuição da entidade publicadora." },
      machine: {
        lead: "Feito para máquinas.",
        body: ({ link }) => (
          <>
            JSON em todo o lado, CORS ativo, OpenAPI 3.1, DCAT 3, um {link("#mcp", "servidor MCP")} e um {link("/llms.txt", "llms.txt")} em texto simples.
          </>
        ),
      },
    },
    reads: {
      records: "Registos",
      currentRecords: "Registos atuais",
      applicableHistory: "Histórico aplicável",
      durableRevisions: "Revisões duradouras",
      hotWindow: "A janela recente",
      durableRanges: "Intervalos duradouros",
    },
    history: {
      events: "A revisão conhecida aplicável de cada evento no intervalo.",
      changes: "Correções e retiradas duradouras, pela ordem em que se ficou a saber delas.",
      series: "Pontos de séries temporais sem duplicados.",
    },
    manners: [
      { lead: "Use intervalos limitados.", body: () => "Os endpoints de histórico exigem um intervalo UTC de no máximo 366 dias e ficam em cache na periferia da rede." },
      {
        lead: "Consulte à frequência do produto.",
        body: () =>
          "A página de cada produto diz com que frequência a fonte corre. Os produtos quase em tempo real atualizam-se a cada um a cinco minutos, a maioria dos outros de hora a hora ou diariamente.",
      },
      {
        lead: "Pagine de forma determinística.",
        body: ({ code }) => <>Siga o {code("nextCursor")} opaco de cada endpoint até ser null; marcas de tempo iguais não são problema.</>,
      },
      { lead: "Atribua à entidade publicadora,", body: () => "não a este site. Os dados são dela; este site guarda-os e serve-os." },
      {
        lead: "Leia primeiro os metadados do produto.",
        body: ({ code }) => (
          <>
            {code("GET /api/products/{slug}")} traz o esquema, a unidade, o número de linhas, a marca de água e se o produto está atrasado, para saber o que as linhas significam
            antes de as obter.
          </>
        ),
      },
      {
        lead: "Algo errado?",
        body: ({ link }) => (
          <>
            A {link("/status/", "página de estado")} mostra a recolha hora a hora nos últimos três dias, e as {link("/operations/#activity", "operações")} mostram todas as
            recolhas, incluindo as que falharam, com um seletor de dia para ver qualquer dia passado.
          </>
        ),
      },
    ],
    entryPoints: {
      products: { title: "Lista de produtos", description: "Todos os produtos com tipo, esquema, contagens e atualidade. Comece aqui." },
      mcp: { title: "Servidor MCP", description: "Para assistentes de IA. Streamable HTTP, sem chave." },
      openapi: { title: "OpenAPI 3.1", description: "O contrato exato de cada endpoint, incluindo parâmetros e formatos de erro." },
      llms: { title: "llms.txt", description: "Um guia em texto simples para modelos de linguagem: o que existe, como chamar e o que evitar." },
      dcat: {
        title: "Catálogo DCAT 3",
        description: "Entradas de conjuntos de dados em JSON-LD com licença, atribuição, entidade publicadora e URL de distribuição.",
      },
      feeds: { title: "Fontes", description: "Cada tarefa de recolha: a origem, a frequência, a última e a próxima recolha. Só de leitura." },
      health: { title: "Saúde", description: "Um único estado em JSON para verificações de disponibilidade." },
    },
    copied: "Copiado",
    copyPrompt: "Copiar o texto de configuração",
    promptCopied: "Texto de configuração copiado",
    eyebrow: "Começar",
    title: (emphasis) => <>Gratuito, sem chave, {emphasis("e para continuar assim")}.</>,
    intro:
      "O open-data.pt recolhe dados públicos portugueses das instituições que os publicam e serve-os em JSON limpo. Não há conta, nem chave de API, nem quota para comprar, nem planos para os ter. Use-o a partir de um script, de um notebook, de uma folha de cálculo ou de qualquer ferramenta que fale HTTP.",
    pledgesLabel: "Com o que pode contar",
    threeRequestsEyebrow: "Três pedidos",
    threeRequestsTitle: "Tudo começa na lista de produtos",
    productIntro: ({ code }) => (
      <>
        Um <strong>produto</strong> é uma tabela que pode ler: registos atuais, uma série temporal, um registo de eventos ou um resumo. No site, um conjunto de dados contém um ou
        mais produtos: cada tabela ou série dentro de um conjunto de dados é um produto. Liste-os, escolha um pelo {code("slug")} e leia as suas linhas. Cada resposta é JSON com
        uma lista {code("data")}.
      </>
    ),
    listProducts: "Listar os produtos",
    listNote: (count) =>
      `Devolve todos os produtos com o tipo, o esquema, o número de linhas, a marca de água e a atualidade. ${count ? `${count} hoje` : "Cerca de 200 hoje"}. Em cache durante 20 segundos na periferia da rede.`,
    readRecords: "Ler os registos atuais de um produto",
    recordsNote: ({ code }) => (
      <>
        Siga o {code("nextCursor")} para a página seguinte. Acrescente {code("validAt=<ISO time>")} para o que era válido nesse momento; as versões anteriores estão nos endpoints
        de histórico.
      </>
    ),
    readSeries: "Ler uma série temporal",
    seriesNote: ({ code }) => (
      <>Os pontos mais recentes primeiro. A janela móvel guarda os últimos 5000 pontos; use o endpoint limitado {code("/series/range")} para o histórico duradouro.</>
    ),
    productPage: ({ code }, example) => (
      <>
        Cada produto tem também uma página para pessoas em {code("/product/?slug=<slug>")}, com um gráfico ou uma tabela, o esquema, a linhagem da recolha que o construiu e
        ligações da API para copiar{example ? <>, como {example}</> : null}.
      </>
    ),
    mcpEyebrow: "Assistentes de IA",
    mcpTitle: "Consulte os dados a partir de um assistente de IA",
    mcpIntro: ({ link }) => (
      <>
        A API é também um <strong>servidor MCP</strong>, construído sobre o {link("https://blog.cloudflare.com/code-mode/", "Code Mode")} da Cloudflare. Copie o endereço para o seu
        cliente MCP, ou copie o texto de configuração e cole-o no seu assistente. Não precisa de chave.
      </>
    ),
    copyMcpAddress: "Copiar o endereço do servidor MCP",
    kindsEyebrow: "Formas",
    kindsTitle: "Cinco tipos de produto, uma regra cada",
    kindsIntro: ({ code }) => <>O campo {code("role")} de um produto diz como ele muda e que histórico tem.</>,
    products: (count) => (count === 1 ? "1 produto" : `${fmt.int(count)} produtos`),
    historyEyebrow: "Histórico",
    historyTitle: "Onde fica o passado",
    historyIntro:
      "Os endpoints rápidos servem uma janela móvel: a versão atual de cada produto e um conjunto limitado de pontos e alterações recentes. Cada revisão com significado é acrescentada a um lago de tabelas Parquet e fica lá. Endpoints tipados e limitados dão acesso a ele:",
    historyCursors: "Os três usam cursores compostos opacos e incluem a atualidade e a cobertura.",
    readYear: "Ler um ano de uma série temporal",
    historyCache: "As janelas que terminaram há mais de uma hora ficam em cache durante um dia; as outras durante cinco minutos.",
    etiquetteEyebrow: "Etiqueta",
    etiquetteTitle: "Limites e boas maneiras",
    everyWayInEyebrow: "Legível por máquinas",
    everyWayInTitle: "Todas as entradas",
    copyAddress: (title) => `Copiar o endereço: ${title}`,
    open: "Abrir",
    onThisPage: "Nesta página",
  },
});
