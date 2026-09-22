/**
 * What link previews and search engines read. The crawlers of X, Facebook,
 * LinkedIn, Slack, messaging apps and Google Dataset Search do not run a page's
 * JavaScript, so the HTML itself carries a canonical URL, Open Graph and X card
 * tags, and on a product page a schema.org Dataset. A page that names one
 * product, publisher or topic gets that one's own title and description, from
 * the same API the page reads in the browser.
 */
import type { JsonObject, JsonValue } from "@open-data-pt/contract";
import type { SiteHost } from "./discovery";
import { UNSTATED_LICENCE } from "@open-data-pt/catalog";
import { every, pagePath, read, readIfFound, topicLabel, type CatalogFeed, type CatalogProduct, type Term } from "./markdown";

const SITE_NAME = "open-data.pt";
/** What the home page's preview says, rather than the bare site name. */
const HOME_HEADING = "Public data from Portugal, in one place";
/** Previews cut descriptions short anyway; past this one ends with an ellipsis. */
const MAX_DESCRIPTION = 300;
/** Google reads a dataset description of 50 to 5,000 characters. */
const MAX_DATASET_DESCRIPTION = 5000;
/** The widest tables have over a hundred fields; past this the markup would outweigh the page. */
const MAX_VARIABLES = 100;

/** A screenshot of the home page at twice 1200×630, so it stays sharp on dense screens. */
export const PREVIEW_IMAGE = {
  path: "/og-image.png",
  type: "image/png",
  width: 2400,
  height: 1260,
  alt: "The open-data.pt home page: public data from Portugal in one place, beside the datasets collected in the last few minutes.",
};

/** The query parameter that names what a page shows; every other parameter stays out of its canonical URL. */
export const NAMING_PARAMETER = new Map([
  ["/product/", "slug"],
  ["/publisher/", "id"],
  ["/licence/", "id"],
  ["/catalog/", "topic"],
]);

interface PageMeta {
  /** The document title: the page's own name, then the site's. */
  title: string;
  /** The page's own name, for og:title. */
  heading: string;
  description: string;
  canonical: string;
  /** schema.org structured data, on pages that show one dataset. */
  dataset?: JsonObject;
}

interface Named {
  heading: string;
  description: string;
  dataset?: JsonObject;
}

/** The page's HTML with its title, description, canonical link, Open Graph and X card tags, and structured data set for this URL. */
export async function withPageMeta(html: string, url: URL, host: SiteHost): Promise<string> {
  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? SITE_NAME);
  const description = decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "");
  const meta = await pageMeta(url, title, description, host);
  // Replacer functions, so a "$" in a product's title is text, not a replacement pattern.
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escape(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, () => `<meta name="description" content="${escape(meta.description)}"`)
    .replace(/\n\s*<\/head>/, (end) => `\n${headTags(meta, url.origin)}${end.slice(1)}`);
}

async function pageMeta(url: URL, title: string, description: string, host: SiteHost): Promise<PageMeta> {
  const path = pagePath(url.pathname);
  const canonical = new URL(path, url.origin);
  const general = { title, heading: path === "/" ? HOME_HEADING : title.replace(/ · open-data\.pt$/, ""), description, canonical: canonical.href };
  const parameter = NAMING_PARAMETER.get(path);
  const value = parameter ? url.searchParams.get(parameter) : null;
  if (!parameter || !value) return general;
  canonical.searchParams.set(parameter, value);
  const named = await namedBy(path, value, host, canonical.href);
  if (!named) return general;
  const meta: PageMeta = {
    title: `${named.heading} · ${SITE_NAME}`,
    heading: named.heading,
    description: clip(named.description || description, MAX_DESCRIPTION),
    canonical: canonical.href,
  };
  if (named.dataset) meta.dataset = named.dataset;
  return meta;
}

/** The product, publisher or topic a page's query names, or undefined when there is none by that name. */
async function namedBy(path: string, value: string, host: SiteHost, canonical: string): Promise<Named | undefined> {
  if (path === "/product/") {
    const product = await readIfFound<CatalogProduct>(host, `/api/products/${encodeURIComponent(value)}`);
    if (!product) return undefined;
    const feed = (await readIfFound<{ data: CatalogFeed }>(host, `/api/feeds/${encodeURIComponent(product.feedId)}`))?.data;
    const source = feed ? `From ${feed.publisher.name}, as free JSON with no key.` : "";
    return { heading: product.title, description: [product.description?.trim(), source].filter(Boolean).join(" "), dataset: dataset(product, feed, canonical) };
  }
  const feeds = (await read<{ data: CatalogFeed[] }>(host, "/api/feeds")).data;
  if (path === "/publisher/") {
    const name = feeds.find((feed) => feed.publisher.id === value)?.publisher.name;
    if (!name) return undefined;
    return { heading: name, description: `Public data that ${name} publishes, collected by open-data.pt and served as free JSON with no key.` };
  }
  if (path === "/licence/") {
    const products = (await read<{ data: CatalogProduct[] }>(host, "/api/products")).data;
    const name = products.find((product) => product.licence?.id === value)?.licence?.name;
    if (!name) return undefined;
    return { heading: name, description: `Every dataset open-data.pt serves under ${name}, as its publisher states it, with its API links.` };
  }
  if (!feeds.some((feed) => feed.topics?.includes(value))) return undefined;
  const label = topicLabel(value);
  return {
    heading: `${label} datasets`,
    description: `Portuguese public data about ${label.toLocaleLowerCase()}: every dataset open-data.pt collects on it, with its publisher and its API links.`,
  };
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
  if (feed)
    data.creator = feed.publisher.url ? { "@type": "Organization", name: feed.publisher.name, url: feed.publisher.url } : { "@type": "Organization", name: feed.publisher.name };
  if (feed?.topics?.length) data.keywords = feed.topics.map(topicLabel);
  if (feed?.sourceUrl && /^https?:\/\//.test(feed.sourceUrl)) data.isBasedOn = feed.sourceUrl;
  const licence = licenceOf(product.licence);
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
  const tags: Array<[string, string, string]> = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", SITE_NAME],
    ["property", "og:url", meta.canonical],
    ["property", "og:title", meta.heading],
    ["property", "og:description", meta.description],
    ["property", "og:image", image],
    ["property", "og:image:type", PREVIEW_IMAGE.type],
    ["property", "og:image:width", String(PREVIEW_IMAGE.width)],
    ["property", "og:image:height", String(PREVIEW_IMAGE.height)],
    ["property", "og:image:alt", PREVIEW_IMAGE.alt],
    // X falls back to the og: tags; its own say the same for readers that only look for these.
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.heading],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", image],
    ["name", "twitter:image:alt", PREVIEW_IMAGE.alt],
  ];
  const lines = [`<link rel="canonical" href="${escape(meta.canonical)}" />`, ...tags.map(([kind, key, value]) => `<meta ${kind}="${key}" content="${escape(value)}" />`)];
  // "<" written as \u003c, so nothing in the data can close the script element early.
  if (meta.dataset) lines.push(`<script type="application/ld+json">${JSON.stringify(meta.dataset).replaceAll("<", "\\u003c")}</script>`);
  return lines.map((line) => `    ${line}\n`).join("");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const decode = (text: string) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
