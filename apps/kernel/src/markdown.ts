/**
 * Every page of the site as Markdown, for a client that sends Accept:
 * text/markdown. The pages draw themselves in the browser from the API; these
 * say the same from the same reads, as text an agent can use directly.
 */
import type { JsonObject, JsonValue } from "@open-data-pt/gatekeeper-shared";
import type { SiteHost } from "./discovery";

export interface CatalogField {
  id: string;
  name: string;
  type: string;
  unit?: string;
}

/** A product as GET /api/products and /api/products/{slug} answer it, in the fields the pages use. */
export interface CatalogProduct {
  slug: string;
  title: string;
  description?: string;
  feedId: string;
  role: string;
  schema: { fields: CatalogField[] };
  rowCount: number;
  updatedAt: string;
  cadenceSeconds?: number;
  licence?: Term;
  attribution?: string;
  stale?: boolean;
  exposeHistory?: boolean;
}

/** A vocabulary entry as the API serves it: a publisher, a licence. */
export interface Term {
  id: string;
  name: string;
  url?: string;
  description?: string;
}

/** A feed as GET /api/feeds answers it, in the fields the pages use. */
export interface CatalogFeed {
  id: string;
  title: string;
  description: string;
  publisher: Term;
  topics?: string[];
  format: string;
  cadenceSeconds: number | null;
  sourceUrl?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  lastAcquisitionStatus?: string;
  consecutiveFailures?: number;
}

interface Outage {
  feedId: string | null;
  startedAt: string;
  endedAt?: string;
  cause: string;
  failures: number;
}

/** One feed and the products it serves: a dataset, as the catalog shows it. */
export interface Dataset {
  feed: CatalogFeed;
  products: CatalogProduct[];
}

/** A page's Markdown, and 404 when the page names something that does not exist. */
export interface PageText {
  status: 200 | 404;
  markdown: string;
}

type Renderer = (url: URL, host: SiteHost) => Promise<PageText>;

/** Rows a product page shows before pointing to the API for the rest. */
const PREVIEW_ROWS = 10;
/** Columns a preview table shows; the schema above it lists every field. */
const PREVIEW_COLUMNS = 8;

const ROLE_LABEL = new Map([
  ["reference", "Reference: a complete, slow-changing set, replaced whole on every collection"],
  ["current-state", "Current state: the latest known state of each entity"],
  ["event-log", "Events: things that happened, with corrections and retractions kept"],
  ["time-series", "Time series: numeric points keyed by series and event time"],
  ["summary", "Summary: an aggregate rebuilt from the same collection as its source product"],
]);
const FORMAT_LABEL = new Map([
  ["arcgis", "ArcGIS"],
  ["opendatasoft", "Opendatasoft"],
  ["ckan", "CKAN"],
  ["gtfs", "GTFS"],
  ["gbfs", "GBFS"],
  ["udata", "dados.gov.pt"],
]);
const UNITS: Array<[number, string]> = [
  [86_400, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
];

const RENDERERS = new Map<string, Renderer>([
  ["/", home],
  ["/catalog/", catalog],
  ["/publisher/", publishers],
  ["/licence/", licences],
  ["/product/", product],
  ["/start/", start],
  ["/status/", status],
  ["/analytics/", analytics],
  ["/operations/", operations],
  ["/contribute/", contribute],
]);

/** "/catalog/index.html" is the same page as "/catalog/". */
export const pagePath = (pathname: string) => pathname.replace(/index\.html$/, "");

/** Whether the path is one of the site's pages, each of which also answers as Markdown. */
export function isPage(pathname: string): boolean {
  return RENDERERS.has(pagePath(pathname));
}

/** The page at this URL as Markdown, or undefined when the path is not a page. */
export async function pageMarkdown(url: URL, host: SiteHost): Promise<PageText | undefined> {
  return RENDERERS.get(pagePath(url.pathname))?.(url, host);
}

/** Whether an Accept header asks for Markdown at least as much as for HTML. */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const weights = new Map<string, number>();
  for (const range of accept.toLowerCase().split(",")) {
    const [type = "", ...parameters] = range.split(";").map((part) => part.trim());
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    weights.set(type, quality ? Number(quality.slice(2)) : 1);
  }
  const markdown = weights.get("text/markdown") ?? 0;
  return markdown > 0 && markdown >= (weights.get("text/html") ?? 0);
}

export const productPage = (slug: string) => `/product/?slug=${encodeURIComponent(slug)}`;
export const publisherPage = (id: string) => `/publisher/?id=${encodeURIComponent(id)}`;
export const licencePage = (id: string) => `/licence/?id=${encodeURIComponent(id)}`;

/** A term as a Markdown link when it has a page, its name otherwise. */
const termLink = (term: Term) => (term.url ? `[${linkText(term.name)}](${term.url})` : linkText(term.name));

/** Every feed that serves at least one product, with its products, by title. */
export async function readCatalog(host: SiteHost): Promise<Dataset[]> {
  const [products, feeds] = await Promise.all([read<{ data: CatalogProduct[] }>(host, "/api/products"), read<{ data: CatalogFeed[] }>(host, "/api/feeds")]);
  const byFeed = new Map<string, CatalogProduct[]>();
  for (const item of products.data) {
    const list = byFeed.get(item.feedId);
    if (list) list.push(item);
    else byFeed.set(item.feedId, [item]);
  }
  const datasets: Dataset[] = [];
  for (const feed of feeds.data) {
    const items = byFeed.get(feed.id);
    if (items) datasets.push({ feed, products: items });
  }
  return datasets.sort((a, b) => a.feed.title.localeCompare(b.feed.title));
}

/* ---------- Pages ---------- */

async function home(url: URL, host: SiteHost): Promise<PageText> {
  const { origin } = url;
  const datasets = await readCatalog(host);
  const publisherCount = new Set(datasets.map((dataset) => dataset.feed.publisher.id)).size;
  const tables = datasets.reduce((sum, dataset) => sum + dataset.products.length, 0);
  const topics = new Map<string, Dataset[]>();
  for (const dataset of datasets) {
    for (const topic of dataset.feed.topics ?? []) topics.set(topic, [...(topics.get(topic) ?? []), dataset]);
  }
  return found([
    "# open-data.pt",
    "",
    "Public data from Portugal, in one place. Datasets published by Portuguese institutions and operators, collected from where they publish them and served in one consistent format. Free to use, with no key and no account. Every dataset names its publisher and links back to the source.",
    "",
    `${plural(datasets.length, "dataset")}, ${plural(tables, "table")} and series, from ${plural(publisherCount, "publisher")}.`,
    "",
    `- [Catalog](${origin}/catalog/): every dataset, with its publisher and its API links`,
    `- [Publishers](${origin}/publisher/): who publishes the data`,
    `- [Licences](${origin}/licence/): the terms each dataset is served under`,
    `- [Use the API](${origin}/start/): free, keyless, read-only JSON, described at ${origin}/openapi.json`,
    `- [Connect an AI assistant](${origin}/start/#mcp): the MCP server at ${origin}/mcp`,
    `- [Status](${origin}/status/): whether every source is being collected`,
    "",
    "## Topics",
    "",
    ...[...topics.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([topic, items]) => `- [${topicLabel(topic)}](${origin}/catalog/?topic=${encodeURIComponent(topic)}): ${plural(items.length, "dataset")} from ${mainPublishers(items)}`),
  ]);
}

async function catalog(url: URL, host: SiteHost): Promise<PageText> {
  const topic = url.searchParams.get("topic") ?? "";
  const words = (url.searchParams.get("q") ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = (await readCatalog(host)).filter(({ feed, products }) => {
    if (topic && !(feed.topics ?? []).includes(topic)) return false;
    const haystack =
      `${feed.title} ${feed.publisher.name} ${(feed.topics ?? []).join(" ")} ${feed.description} ${products.map((item) => `${item.title} ${item.slug}`).join(" ")}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const scope = [topic ? `about ${topicLabel(topic).toLocaleLowerCase()}` : "", words.length ? `matching “${words.join(" ")}”` : ""].filter(Boolean).join(" ");
  return found([
    topic ? `# ${topicLabel(topic)}` : "# Catalog",
    "",
    `${plural(shown.length, "dataset")}${scope ? ` ${scope}` : ""}, each collected from its publisher. Every table and series links to its page and to its JSON in the API.`,
    "",
    ...shown.flatMap((dataset) => datasetSection(url.origin, dataset)),
  ]);
}

/** The datasets under each value of one vocabulary, by key, with the term as the first dataset states it. */
function groupBy(datasets: Dataset[], termOf: (dataset: Dataset) => Term | undefined): Map<string, { term: Term; items: Dataset[] }> {
  const groups = new Map<string, { term: Term; items: Dataset[] }>();
  for (const dataset of datasets) {
    const term = termOf(dataset);
    if (!term) continue;
    const group = groups.get(term.id) ?? { term, items: [] };
    group.items.push(dataset);
    groups.set(term.id, group);
  }
  return groups;
}

async function publishers(url: URL, host: SiteHost): Promise<PageText> {
  const { origin } = url;
  const groups = groupBy(await readCatalog(host), (dataset) => dataset.feed.publisher);
  const wanted = url.searchParams.get("id");
  if (wanted !== null) {
    const own = groups.get(wanted);
    if (!own)
      return missing(["# Publisher not found", "", `open-data.pt collects nothing from a publisher called “${wanted}”. Every publisher is listed at ${origin}/publisher/.`]);
    const { name } = own.term;
    return found([
      `# ${name}`,
      "",
      `${plural(own.items.length, "dataset")} that ${name} publishes, collected from where it publishes them. open-data.pt republishes them; ${name} owns the data.${own.term.url ? ` Its site: ${own.term.url}` : ""}`,
      "",
      ...own.items.flatMap((dataset) => datasetSection(origin, dataset)),
    ]);
  }
  return found([
    "# Publishers",
    "",
    "Institutions and operators whose data open-data.pt collects. We republish their data; they own it.",
    "",
    ...[...groups.values()]
      .sort((a, b) => b.items.length - a.items.length || a.term.name.localeCompare(b.term.name))
      .map(({ term, items }) => {
        const topics = [...new Set(items.flatMap((dataset) => dataset.feed.topics ?? []))].map(topicLabel).join(", ");
        return `- [${linkText(term.name)}](${origin}${publisherPage(term.id)}): ${plural(items.length, "dataset")}${topics ? ` · ${topics}` : ""}`;
      }),
  ]);
}

async function licences(url: URL, host: SiteHost): Promise<PageText> {
  const { origin } = url;
  const groups = groupBy(await readCatalog(host), (dataset) => dataset.products.find((item) => item.licence)?.licence);
  const wanted = url.searchParams.get("id");
  if (wanted !== null) {
    const own = groups.get(wanted);
    if (!own) return missing(["# Licence not found", "", `open-data.pt serves nothing under a licence called “${wanted}”. Every licence is listed at ${origin}/licence/.`]);
    const { name, url: text } = own.term;
    const publishers = [...new Set(own.items.map((dataset) => dataset.feed.publisher.name))].sort();
    return found([
      `# ${name}`,
      "",
      own.term.description ?? `${plural(own.items.length, "dataset")} served under ${name}${text ? ` (${text})` : ""}.`,
      "",
      `${plural(own.items.length, "dataset")} from ${publishers.join(", ")}. The terms are the publisher's; cite the publisher, not open-data.pt.`,
      "",
      ...own.items.flatMap((dataset) => datasetSection(origin, dataset)),
    ]);
  }
  return found([
    "# Licences",
    "",
    "The terms each dataset is served under, as its publisher states them. Where a publisher states none, its own terms apply.",
    "",
    ...[...groups.values()]
      .sort((a, b) => b.items.length - a.items.length || a.term.name.localeCompare(b.term.name))
      .map(({ term, items }) => {
        const publishers = new Set(items.map((dataset) => dataset.feed.publisher.id)).size;
        return `- [${linkText(term.name)}](${origin}${licencePage(term.id)}): ${plural(items.length, "dataset")} from ${plural(publishers, "publisher")}`;
      }),
  ]);
}

async function product(url: URL, host: SiteHost): Promise<PageText> {
  const { origin } = url;
  const slug = url.searchParams.get("slug") ?? "";
  const path = `/api/products/${encodeURIComponent(slug)}`;
  const item = slug ? await readIfFound<CatalogProduct>(host, path) : undefined;
  if (!item)
    return missing(["# Product not found", "", `No product has the slug “${slug}”. Every product is listed at ${origin}/catalog/, and as JSON at ${origin}/api/products.`]);

  const series = item.role === "time-series";
  const [feed, rows] = await Promise.all([
    readIfFound<{ data: CatalogFeed }>(host, `/api/feeds/${encodeURIComponent(item.feedId)}`).then((answer) => answer?.data),
    read<{ data: JsonObject[] }>(host, `${path}/${series ? "series" : "records"}?limit=${PREVIEW_ROWS}`).then((answer) => answer.data),
  ]);
  const fields = item.schema.fields;
  const columns = series ? ["seriesKey", "eventTime", "value", "unit"] : fields.slice(0, PREVIEW_COLUMNS).map((field) => field.id);
  const geographic = fields.some((field) => field.type === "geometry" || field.type === "latitude");
  const facts: Array<[string, string | undefined]> = [
    ["Publisher", feed && `[${linkText(feed.publisher.name)}](${origin}${publisherPage(feed.publisher.id)})`],
    ["Dataset", feed?.title],
    ["Kind", ROLE_LABEL.get(item.role) ?? item.role],
    ["Rows", String(item.rowCount)],
    ["Updated", item.stale ? `${item.updatedAt} (late: the last collection is older than expected)` : item.updatedAt],
    ["Collected", item.cadenceSeconds ? every(item.cadenceSeconds) : undefined],
    ["Licence", item.licence && `${termLink(item.licence)} — ${origin}${licencePage(item.licence.id)}`],
    ["Attribution", item.attribution],
    ["Source", feed?.sourceUrl],
  ];

  return found([
    `# ${item.title}`,
    "",
    ...(item.description ? [item.description.trim(), ""] : []),
    ...facts.flatMap(([name, value]) => (value ? [`- **${name}:** ${value}`] : [])),
    "",
    `Cite ${item.attribution ?? feed?.publisher.name ?? "the publisher"} and the licence above, not open-data.pt.`,
    "",
    "## Fields",
    "",
    "| Field | Name | Type | Unit |",
    "| --- | --- | --- | --- |",
    ...fields.map((field) => `| \`${cell(field.id)}\` | ${cell(field.name)} | ${cell(field.type)} | ${cell(field.unit ?? "")} |`),
    "",
    series ? "## Latest points" : "## First rows",
    "",
    ...(rows.length === 0
      ? ["The source currently lists nothing."]
      : [
          `| ${columns.map(cell).join(" | ")} |`,
          `| ${columns.map(() => "---").join(" | ")} |`,
          ...rows.map((row) => `| ${columns.map((column) => cell(value(row[column]))).join(" | ")} |`),
        ]),
    "",
    "## Read it as JSON",
    "",
    `- This product: ${origin}${path}`,
    series
      ? `- Points: ${origin}${path}/series?limit=1000 (seriesKey, from, to)`
      : `- Rows: ${origin}${path}/records?limit=500, following nextCursor, or every row at ${origin}${path}/records/all`,
    ...(geographic ? [`- GeoJSON: ${origin}${path}.geojson`] : []),
    ...(item.exposeHistory ? [`- History: ${origin}${path}/${item.role === "event-log" ? "events" : series ? "series/range" : "changes/range"}?from=<ISO>&to=<ISO>`] : []),
  ]);
}

/** The start page is the API guide, which /llms.txt already is in Markdown. */
async function start(url: URL, host: SiteHost): Promise<PageText> {
  const response = await host.assets(new Request(new URL("/llms.txt", url.origin)));
  if (!response.ok) throw new Error(`/llms.txt answered ${response.status}`);
  return found([(await response.text()).trimEnd()]);
}

async function status(url: URL, host: SiteHost): Promise<PageText> {
  const days = 3;
  const [feeds, outages] = await Promise.all([
    read<{ data: CatalogFeed[] }>(host, "/api/feeds"),
    read<{ trackedSince: string | null; data: Outage[] }>(host, `/api/outages?days=${days}`),
  ]);
  const titles = new Map(feeds.data.map((feed) => [feed.id, feed.title]));
  const titleOf = (outage: Outage) => (outage.feedId === null ? "The whole platform" : (titles.get(outage.feedId) ?? outage.feedId));
  const open = outages.data.filter((outage) => !outage.endedAt);
  const ended = outages.data
    .filter((outage) => outage.endedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 30);
  return found([
    "# Status",
    "",
    `Whether open-data.pt is collecting every source, and when each was unavailable in the last ${days} days${outages.trackedSince ? ` (tracked since ${outages.trackedSince})` : ""}. The same as JSON: ${url.origin}/api/outages?days=${days}`,
    "",
    "## Now",
    "",
    ...(open.length === 0
      ? ["Every source is answering."]
      : open.map((outage) => `- **${titleOf(outage)}**: not collected since ${outage.startedAt}, ${plural(outage.failures, "failed attempt")} (cause: ${outage.cause})`)),
    "",
    "## Recent outages",
    "",
    ...(ended.length === 0
      ? ["None."]
      : [
          "| Dataset | From | To | Cause | Failed attempts |",
          "| --- | --- | --- | --- | --- |",
          ...ended.map((outage) => `| ${cell(titleOf(outage))} | ${outage.startedAt} | ${outage.endedAt ?? ""} | ${outage.cause} | ${outage.failures} |`),
        ]),
  ]);
}

/** What /api/analytics answers, as far as this page reads it. */
interface UsageReport {
  from: string;
  timeline: Array<{ surface: string; kind: string; requests: number }>;
  clients: Array<{ surface: string; kind: string; name: string; requests: number }>;
  subjects: Array<{ surface: string; route: string; subject: string; requests: number }>;
  countries: Array<{ surface: string; country: string; requests: number }>;
}

const SURFACE_LABEL = new Map([
  ["web", "Website pages"],
  ["api", "API requests"],
  ["mcp", "MCP messages"],
  ["mcp-read", "API reads by MCP code runs"],
  ["docs", "API reference"],
  ["discovery", "Discovery documents"],
]);

async function analytics(url: URL, host: SiteHost): Promise<PageText> {
  const days = 7;
  const response = await host.api(`/api/analytics?days=${days}`);
  const head = [
    "# Analytics",
    "",
    `How open-data.pt is used: requests to the website, the API and the MCP server, counted by Cloudflare Workers Analytics Engine. No IP address, cookie or visitor identifier is kept. The same as JSON: ${url.origin}/api/analytics?days=${days} (also days=1, 30 or 90).`,
    "",
  ];
  if (response.status === 503) return found([...head, "Usage analytics are not enabled on this deployment."]);
  if (!response.ok) throw new Error(`GET /api/analytics answered ${response.status}`);
  // SAFETY: /api/analytics answers the AnalyticsReport its OpenAPI entry declares; this page reads a subset.
  const report = (await response.json()) as UsageReport;
  const total = (rows: Array<{ surface: string; requests: number }>, surface: string) => rows.filter((row) => row.surface === surface).reduce((sum, row) => sum + row.requests, 0);
  const top = <T extends { requests: number }>(rows: T[], count: number) => [...rows].sort((a, b) => b.requests - a.requests).slice(0, count);
  const sum = new Map<string, number>();
  for (const row of report.clients.filter((each) => each.surface !== "mcp-read")) sum.set(`${row.kind}|${row.name}`, (sum.get(`${row.kind}|${row.name}`) ?? 0) + row.requests);
  const countries = new Map<string, number>();
  for (const row of report.countries.filter((each) => each.surface !== "mcp-read")) countries.set(row.country, (countries.get(row.country) ?? 0) + row.requests);
  return found([
    ...head,
    `## The last ${days} days (since ${report.from})`,
    "",
    ...[...SURFACE_LABEL].map(([surface, label]) => `- ${label}: ${total(report.timeline, surface)}`),
    "",
    "## Clients",
    "",
    "| Client | Kind | Requests |",
    "| --- | --- | --- |",
    ...top(
      [...sum].map(([key, requests]) => ({ key, requests })),
      20,
    ).map(({ key, requests }) => {
      const [kind = "", name = ""] = key.split("|");
      return `| ${cell(name)} | ${kind} | ${requests} |`;
    }),
    "",
    "## Most read datasets",
    "",
    "| Dataset | Where | Requests |",
    "| --- | --- | --- |",
    ...top(report.subjects, 20).map((row) => `| ${cell(row.subject)} | ${SURFACE_LABEL.get(row.surface) ?? row.surface}, ${row.route} | ${row.requests} |`),
    "",
    "## Countries",
    "",
    ...top(
      [...countries].map(([country, requests]) => ({ country, requests })),
      15,
    ).map((row) => `- ${row.country}: ${row.requests}`),
  ]);
}

async function operations(url: URL, host: SiteHost): Promise<PageText> {
  const feeds = (await read<{ data: CatalogFeed[] }>(host, "/api/feeds")).data.sort((a, b) => a.title.localeCompare(b.title));
  return found([
    "# Operations",
    "",
    `Every feed open-data.pt collects: who publishes it, how often it is collected, and how its last collection went. Each run is at ${url.origin}/api/acquisitions.`,
    "",
    "| Dataset | Publisher | Collected | Last success | Last run | Next run |",
    "| --- | --- | --- | --- | --- | --- |",
    ...feeds.map((feed) => {
      const failures = feed.consecutiveFailures ? `, ${plural(feed.consecutiveFailures, "failure")} in a row` : "";
      return `| ${cell(feed.title)} | ${cell(feed.publisher.name)} | ${feed.cadenceSeconds ? every(feed.cadenceSeconds) : "not scheduled"} | ${feed.lastSuccessAt ?? "never"} | ${feed.lastAcquisitionStatus ?? ""}${failures} | ${feed.nextRunAt ?? ""} |`;
    }),
  ]);
}

/** The repository, as the site's lib/project.ts names it. */
const REPOSITORY = "https://github.com/corrreia/open-data.pt";
const CONTRIBUTING = `${REPOSITORY}/blob/main/CONTRIBUTING.md`;

async function contribute(): Promise<PageText> {
  return found([
    "# Contribute",
    "",
    "open-data.pt is open source. Anyone can suggest a source or report one that broke, and a new dataset from a source we already read is often a single entry of code.",
    "",
    `- **Suggest a source** (no code): ${REPOSITORY}/issues/new?template=suggest-source.yml`,
    `- **Report a broken source** (no code): ${REPOSITORY}/issues/new?template=broken-source.yml`,
    `- **Add a dataset** (one entry of TypeScript): ${CONTRIBUTING}#a-new-dataset-from-a-source-we-already-read`,
    `- **Add a source or a format** (TypeScript, with tests): ${CONTRIBUTING}#a-new-bespoke-source`,
    "",
    `The code is at ${REPOSITORY}, under the MIT licence. The data is not: it belongs to its publishers, under their licences. The maintainer reviews and deploys; a pull request never needs secrets or access to Cloudflare.`,
  ]);
}

/* ---------- Pieces ---------- */

function datasetSection(origin: string, { feed, products }: Dataset): string[] {
  const facts = [feed.publisher.name, ...(feed.topics ?? []).map(topicLabel), feed.cadenceSeconds ? `collected ${every(feed.cadenceSeconds)}` : "", through(feed)]
    .filter(Boolean)
    .join(" · ");
  return [
    `## ${feed.title}`,
    "",
    facts,
    "",
    ...(feed.description ? [feed.description.trim(), ""] : []),
    ...products.map(
      (item) =>
        `- [${linkText(item.title)}](${origin}${productPage(item.slug)}): ${(ROLE_LABEL.get(item.role) ?? item.role).split(":")[0]}, ${plural(item.rowCount, "row")}, updated ${item.updatedAt}. JSON: ${origin}/api/products/${encodeURIComponent(item.slug)}`,
    ),
    "",
  ];
}

/** The three publishers with the most datasets among these. */
function mainPublishers(datasets: Dataset[]): string {
  const counts = new Map<string, number>();
  for (const dataset of datasets) counts.set(dataset.feed.publisher.name, (counts.get(dataset.feed.publisher.name) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)
    .join(" · ");
}

function through(feed: CatalogFeed): string {
  const format = FORMAT_LABEL.get(feed.format);
  return format ? `through ${format}` : "through the publisher's own API";
}

export function every(seconds: number): string {
  const [size, unit] = UNITS.find(([length]) => seconds % length === 0) ?? [1, "second"];
  const count = seconds / size;
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

export const topicLabel = (topic: string) => topic.charAt(0).toLocaleUpperCase() + topic.slice(1).replaceAll("-", " ");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/** Text for inside a link's brackets. */
const linkText = (text: string) => text.replace(/[[\]\\]/g, "\\$&");
/** Text for a table cell: one line, pipes escaped, long values cut. */
const cell = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return (line.length > 80 ? `${line.slice(0, 79)}…` : line).replaceAll("|", "\\|");
};
/** A JSON value as cell text: objects and arrays as JSON, nothing as empty. */
const value = (item: JsonValue | undefined) => (item === undefined || item === null ? "" : item instanceof Object ? JSON.stringify(item) : String(item));

const found = (lines: string[]): PageText => ({ status: 200, markdown: `${lines.join("\n")}\n` });
const missing = (lines: string[]): PageText => ({ status: 404, markdown: `${lines.join("\n")}\n` });

/** One API read; any answer but 200 is an error, since every path read here exists. */
export async function read<T>(host: SiteHost, path: string): Promise<T> {
  const response = await host.api(path);
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return response.json<T>();
}

/** One API read of something a URL names, which may not exist. */
export async function readIfFound<T>(host: SiteHost, path: string): Promise<T | undefined> {
  const response = await host.api(path);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  return response.json<T>();
}
