/**
 * What link previews and search engines read. The crawlers of X, Facebook,
 * LinkedIn, Slack, messaging apps and Google Dataset Search do not run a page's
 * JavaScript, so the HTML itself carries a canonical URL, Open Graph and X card
 * tags, and on a product page a schema.org Dataset. A page that names one
 * product, publisher or topic gets that one's own title and description, from
 * the same API the page reads in the browser.
 */
import { UNSTATED_LICENCE, type JsonObject, type JsonValue } from "@open-data-pt/contract";
import type { SiteHost } from "#/pages/discovery";
import { topicName, type Feed as CatalogFeed, type Product as CatalogProduct, type Term } from "@open-data-pt/api";
import { every, pagePath, read, readIfFound } from "#/pages/markdown";

const SITE_NAME = "open-data.pt";

/** A screenshot of the home page at twice 1200×630, so it stays sharp on dense screens. */
export const PREVIEW_IMAGE = {
  path: "/og-image.png",
  type: "image/png",
  width: 2400,
  height: 1260,
  alt: "The open-data.pt home page: public data from Portugal in one place, beside the datasets collected in the last few minutes.",
};

/** The site's languages: English where the pages always were, European Portuguese under /pt/. */
export type Language = "en" | "pt";
const PORTUGUESE_PREFIX = /^\/pt(?=\/|$)/;
export const languageOf = (pathname: string): Language => (PORTUGUESE_PREFIX.test(pathname) ? "pt" : "en");
/** "/pt/catalog/" is the Portuguese "/catalog/". */
export const englishPath = (pathname: string) => pathname.replace(PORTUGUESE_PREFIX, "") || "/";
export const portuguesePath = (pathname: string) => `/pt${englishPath(pathname)}`;

/** What `lang`, `hreflang` and `og:locale` call each language. */
const LANGUAGE_TAG = { en: "en", pt: "pt-PT" } satisfies { [language in Language]: string };
const OG_LOCALE = { en: "en_GB", pt: "pt_PT" } satisfies { [language in Language]: string };

/**
 * The words of the head that are not the page's own. A page file carries its English title and
 * description; a Portuguese page takes them from here.
 */
interface HeadWords {
  homeHeading: string;
  /** Each page's title and description, by path; English pages read theirs from the file. */
  pages: Map<string, { title: string; description: string }>;
  /** What the page says without JavaScript, when it says it in another language than the file. */
  noscript: string;
  source: (publisher: string) => string;
  publisher: (name: string) => string;
  licence: (name: string) => string;
  topicHeading: (topic: string) => string;
  topic: (topic: string) => string;
  previewAlt: string;
}

const WORDS = {
  en: {
    homeHeading: "Public data from Portugal, in one place",
    pages: new Map<string, { title: string; description: string }>(),
    noscript: "",
    source: (publisher: string) => `From ${publisher}, as free JSON with no key.`,
    publisher: (name: string) => `Public data that ${name} publishes, collected by open-data.pt and served as free JSON with no key.`,
    licence: (name: string) => `Every dataset open-data.pt serves under ${name}, as its publisher states it, with its API links.`,
    topicHeading: (topic: string) => `${topic} datasets`,
    topic: (topic: string) => `Portuguese public data about ${topic.toLocaleLowerCase()}: every dataset open-data.pt collects on it, with its publisher and its API links.`,
    previewAlt: PREVIEW_IMAGE.alt,
  },
  pt: {
    homeHeading: "Dados públicos de Portugal, num só lugar",
    pages: new Map([
      [
        "/",
        { title: "open-data.pt", description: "Dados públicos portugueses, das instituições que os publicam, reunidos num só lugar e servidos por uma API gratuita e sem chave." },
      ],
      [
        "/catalog/",
        {
          title: "Catálogo",
          description: "Todos os conjuntos de dados que o open-data.pt recolhe, filtráveis por tema, entidade publicadora, tipo de dados, frequência de atualização e formato.",
        },
      ],
      ["/publisher/", { title: "Entidades publicadoras", description: "As instituições e os operadores cujos dados públicos o open-data.pt recolhe, e o que cada um publica." }],
      [
        "/licence/",
        {
          title: "Licenças",
          description: "Os termos em que cada conjunto de dados do open-data.pt é servido, tal como a entidade publicadora os declara, e todos os conjuntos de dados em cada um.",
        },
      ],
      ["/product/", { title: "Conjunto de dados", description: "Uma tabela de dados do open-data.pt: os registos, o mapa ou o gráfico, o esquema, o histórico e a origem." }],
      ["/start/", { title: "Começar", description: "Como usar o open-data.pt: uma API JSON gratuita e sem chave sobre dados públicos portugueses." }],
      ["/status/", { title: "Estado", description: "O histórico horário da recolha dos conjuntos de dados do open-data.pt nos últimos 3 dias." }],
      [
        "/analytics/",
        {
          title: "Estatísticas",
          description: "Como o open-data.pt é usado: pedidos ao site, à API e ao servidor MCP, por cliente, conjunto de dados e país. Sem cookies e sem endereços IP.",
        },
      ],
      ["/operations/", { title: "Operações", description: "Todas as fontes, todas as recolhas, as regras que seguem e os recursos que o open-data.pt consome." }],
      [
        "/contribute/",
        {
          title: "Contribuir",
          description: "Como ajudar o open-data.pt: sugerir uma fonte, acrescentar um conjunto de dados ou avisar de um que esteja avariado. O código é aberto.",
        },
      ],
      [
        "/aup/",
        {
          title: "Utilização aceitável",
          description:
            "O que pode fazer com os dados que o open-data.pt republica, o que pedimos a quem usa a API e como uma entidade publicadora nos contacta para corrigir uma licença ou pedir a remoção.",
        },
      ],
    ]),
    noscript: 'O open-data.pt precisa de JavaScript para as suas páginas. A API funciona sem ele: <a href="/api/products">/api/products</a>.',
    source: (publisher: string) => `Publicado por ${publisher}, em JSON gratuito e sem chave.`,
    publisher: (name: string) => `Dados públicos publicados por ${name}, recolhidos pelo open-data.pt e servidos em JSON gratuito e sem chave.`,
    licence: (name: string) => `Todos os conjuntos de dados que o open-data.pt serve com ${name}, tal como a entidade publicadora o declara, com as ligações da API.`,
    topicHeading: (topic: string) => `${topic}: conjuntos de dados`,
    topic: (topic: string) =>
      `Dados públicos portugueses sobre ${topic.toLocaleLowerCase("pt-PT")}: todos os conjuntos de dados que o open-data.pt recolhe sobre o tema, com a entidade publicadora e as ligações da API.`,
    previewAlt: "A página inicial do open-data.pt: dados públicos de Portugal num só lugar, ao lado dos conjuntos de dados recolhidos nos últimos minutos.",
  },
} satisfies { [language in Language]: HeadWords };
/** Previews cut descriptions short anyway; past this one ends with an ellipsis. */
const MAX_DESCRIPTION = 300;
/** Google reads a dataset description of 50 to 5,000 characters. */
const MAX_DATASET_DESCRIPTION = 5000;
/** The widest tables have over a hundred fields; past this the markup would outweigh the page. */
const MAX_VARIABLES = 100;

/** The query parameter that names what a page shows; every other parameter stays out of its canonical URL. */
export const NAMING_PARAMETER = new Map([
  ["/product/", "slug"],
  ["/publisher/", "id"],
  ["/licence/", "id"],
  ["/catalog/", "topic"],
]);

interface PageMeta {
  language: Language;
  /** The document title: the page's own name, then the site's. */
  title: string;
  /** The page's own name, for og:title. */
  heading: string;
  description: string;
  canonical: string;
  /** The same page in each language. */
  alternates: { [language in Language]: string };
  /** schema.org structured data, on pages that show one dataset. */
  dataset?: JsonObject;
}

interface Named {
  heading: string;
  description: string;
  dataset?: JsonObject;
}

/**
 * The page's HTML with its title, description, canonical link, links to the page in each language,
 * Open Graph and X card tags, and structured data set for this URL. A Portuguese page (/pt/…) also
 * gets its language and its Portuguese words.
 */
export async function withPageMeta(html: string, url: URL, host: SiteHost): Promise<string> {
  const language = languageOf(url.pathname);
  const path = pagePath(englishPath(url.pathname));
  const words = WORDS[language];
  const own = words.pages.get(path);
  const title = own ? (path === "/" ? own.title : `${own.title} · ${SITE_NAME}`) : decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? SITE_NAME);
  const description = own?.description ?? decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "");
  const meta = await pageMeta(url, path, language, title, description, host);
  // Replacer functions, so a "$" in a product's title is text, not a replacement pattern.
  const rewritten = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escape(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, () => `<meta name="description" content="${escape(meta.description)}"`)
    .replace(/\n\s*<\/head>/, (end) => `\n${headTags(meta, url.origin)}${end.slice(1)}`);
  if (language === "en") return rewritten;
  return rewritten
    .replace(/<html lang="[^"]*"/, () => `<html lang="${LANGUAGE_TAG[language]}"`)
    .replace(/<noscript>[^<]*<a[^>]*>[^<]*<\/a>\.<\/noscript>/, () => `<noscript>${words.noscript}</noscript>`);
}

async function pageMeta(url: URL, path: string, language: Language, title: string, description: string, host: SiteHost): Promise<PageMeta> {
  const general: PageMeta = {
    language,
    title,
    heading: path === "/" ? WORDS[language].homeHeading : title.replace(/ · open-data\.pt$/, ""),
    description,
    ...addresses(new URL(path, url.origin), language),
  };
  const parameter = NAMING_PARAMETER.get(path);
  const value = parameter ? url.searchParams.get(parameter) : null;
  if (!parameter || !value) return general;
  const named = new URL(path, url.origin);
  named.searchParams.set(parameter, value);
  const { canonical, alternates } = addresses(named, language);
  const found = await namedBy(path, value, language, host, canonical);
  if (!found) return general;
  const meta: PageMeta = {
    ...general,
    title: `${found.heading} · ${SITE_NAME}`,
    heading: found.heading,
    description: clip(found.description || description, MAX_DESCRIPTION),
    canonical,
    alternates,
  };
  if (found.dataset) meta.dataset = found.dataset;
  return meta;
}

/** The page's address in each language, from its English one, and which of them is this page's. */
function addresses(english: URL, language: Language): Pick<PageMeta, "canonical" | "alternates"> {
  const alternates = { en: english.href, pt: new URL(`${portuguesePath(english.pathname)}${english.search}`, english.origin).href };
  return { canonical: alternates[language], alternates };
}

/** The product, publisher or topic a page's query names, or undefined when there is none by that name. */
async function namedBy(path: string, value: string, language: Language, host: SiteHost, canonical: string): Promise<Named | undefined> {
  const words = WORDS[language];
  if (path === "/product/") {
    const product = await readIfFound<CatalogProduct>(host, `/api/products/${encodeURIComponent(value)}`);
    if (!product) return undefined;
    const feed = (await readIfFound<{ data: CatalogFeed }>(host, `/api/feeds/${encodeURIComponent(product.feedId)}`))?.data;
    const source = feed ? words.source(feed.publisher.name) : "";
    return { heading: product.title, description: [product.description?.trim(), source].filter(Boolean).join(" "), dataset: dataset(product, feed, canonical) };
  }
  const feeds = (await read<{ data: CatalogFeed[] }>(host, "/api/feeds")).data;
  if (path === "/publisher/") {
    const name = feeds.find((feed) => feed.publisher.id === value)?.publisher.name;
    if (!name) return undefined;
    return { heading: name, description: words.publisher(name) };
  }
  if (path === "/licence/") {
    const products = (await read<{ data: CatalogProduct[] }>(host, "/api/products")).data;
    const name = products.find((product) => product.licence?.id === value)?.licence?.name;
    if (!name) return undefined;
    return { heading: name, description: words.licence(name) };
  }
  if (!feeds.some((feed) => feed.topics.includes(value))) return undefined;
  const label = topicName(value, language);
  return { heading: words.topicHeading(label), description: words.topic(label) };
}

/**
 * A product as a schema.org Dataset, the markup Google Dataset Search indexes:
 * who publishes it, under what licence, what it measures, and where to download it.
 * https://developers.google.com/search/docs/appearance/structured-data/dataset
 */
function dataset(product: CatalogProduct, feed: CatalogFeed | undefined, canonical: string): JsonObject {
  const origin = new URL(canonical).origin;
  const api = `${origin}/api/products/${encodeURIComponent(product.slug)}`;
  const geographic = product.schema.fields.some((field) => field.type === "geometry" || field.type === "latitude");
  const downloads: JsonObject[] = [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: product.role === "time-series" ? `${api}/series?limit=1000` : `${api}/records/all` },
    ...(geographic ? [{ "@type": "DataDownload", encodingFormat: "application/geo+json", contentUrl: `${api}.geojson` }] : []),
  ];
  const variables = product.schema.fields.slice(0, MAX_VARIABLES).map((field) => {
    const variable: JsonObject = { "@type": "PropertyValue", name: field.name };
    if (field.unit) variable.unitText = field.unit;
    return variable;
  });
  const data: JsonObject = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: product.title,
    description: datasetDescription(product, feed),
    url: canonical,
    isAccessibleForFree: true,
    dateModified: product.updatedAt,
    spatialCoverage: { "@type": "Place", name: "Portugal" },
    includedInDataCatalog: { "@type": "DataCatalog", name: SITE_NAME, url: `${origin}/catalog/` },
    distribution: downloads,
    variableMeasured: variables,
  };
  if (feed) {
    const { publisher } = feed;
    data.creator = publisher.url ? { "@type": "Organization", name: publisher.name, url: publisher.url } : { "@type": "Organization", name: publisher.name };
  }
  if (feed?.topics.length) data.keywords = feed.topics.map((topic) => topicName(topic, "en"));
  if (feed?.sourceUrl && /^https?:\/\//.test(feed.sourceUrl)) data.isBasedOn = feed.sourceUrl;
  const licence = licenceOf(product.licence ?? undefined);
  if (licence) data.license = licence;
  return data;
}

/** The product's own words, then who publishes it and how it reaches open-data.pt: always past Google's 50-character minimum. */
function datasetDescription(product: CatalogProduct, feed: CatalogFeed | undefined): string {
  const about = product.description?.trim() || product.title;
  const sentence = /[.!?]$/.test(about) ? about : `${about}.`;
  const collected = product.cadenceSeconds ? `, collected ${every(product.cadenceSeconds)}` : "";
  return clip(`${sentence} Published by ${feed?.publisher.name ?? "its source"}${collected} by open-data.pt and served as free JSON with no key.`, MAX_DATASET_DESCRIPTION);
}

/** A licence with a canonical text is linked; a publisher's own terms are named; none stated means none in the markup. */
function licenceOf(licence: Term | undefined): JsonValue | undefined {
  if (!licence || licence.id === UNSTATED_LICENCE) return undefined;
  return licence.url ?? { "@type": "CreativeWork", name: licence.name };
}

function headTags(meta: PageMeta, origin: string): string {
  const image = `${origin}${PREVIEW_IMAGE.path}`;
  const alt = WORDS[meta.language].previewAlt;
  const other: Language = meta.language === "pt" ? "en" : "pt";
  const tags: Array<[string, string, string]> = [
    ["property", "og:type", "website"],
    ["property", "og:locale", OG_LOCALE[meta.language]],
    ["property", "og:locale:alternate", OG_LOCALE[other]],
    ["property", "og:site_name", SITE_NAME],
    ["property", "og:url", meta.canonical],
    ["property", "og:title", meta.heading],
    ["property", "og:description", meta.description],
    ["property", "og:image", image],
    ["property", "og:image:type", PREVIEW_IMAGE.type],
    ["property", "og:image:width", String(PREVIEW_IMAGE.width)],
    ["property", "og:image:height", String(PREVIEW_IMAGE.height)],
    ["property", "og:image:alt", alt],
    // X falls back to the og: tags; its own say the same for readers that only look for these.
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.heading],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", image],
    ["name", "twitter:image:alt", alt],
  ];
  const lines = [
    `<link rel="canonical" href="${escape(meta.canonical)}" />`,
    `<link rel="alternate" hreflang="${LANGUAGE_TAG.en}" href="${escape(meta.alternates.en)}" />`,
    `<link rel="alternate" hreflang="${LANGUAGE_TAG.pt}" href="${escape(meta.alternates.pt)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escape(meta.alternates.en)}" />`,
    ...tags.map(([kind, key, value]) => `<meta ${kind}="${key}" content="${escape(value)}" />`),
  ];
  // "<" written as \u003c, so nothing in the data can close the script element early.
  if (meta.dataset) lines.push(`<script type="application/ld+json">${JSON.stringify(meta.dataset).replaceAll("<", "\\u003c")}</script>`);
  return lines.map((line) => `    ${line}\n`).join("");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const decode = (text: string) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
