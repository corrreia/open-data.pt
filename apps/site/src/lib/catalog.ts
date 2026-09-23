// Datasets built from the product and feed lists, the facets they filter by, and the words the catalog uses.

import { apiGet } from "./api";
import type { Feed, Product, Role, Term } from "./types";

export interface RoleMeta {
  label: string;
  short: string;
  description: string;
}

export const ROLE = {
  reference: {
    label: "Reference",
    short: "Reference",
    description: "A complete set that changes slowly, such as stops or stations. Each collection replaces the whole set.",
  },
  "current-state": {
    label: "Current state",
    short: "Current",
    description: "The latest known state of each thing, such as where a vehicle is now. Each collection replaces it.",
  },
  "event-log": {
    label: "Events",
    short: "Events",
    description: "Things that happened, such as service alerts. When the publisher corrects or withdraws one, the change is kept beside the original.",
  },
  "time-series": {
    label: "Time series",
    short: "Series",
    description: "Numbers measured over time, one series per thing measured. When the publisher corrects a point, the correction is logged.",
  },
  summary: {
    label: "Summary",
    short: "Summary",
    description: "Totals worked out from another table in the same dataset, updated whenever that table is.",
  },
} satisfies { [role in Role]: RoleMeta };

export const topicLabel = (topic: string) => topic.charAt(0).toLocaleUpperCase() + topic.slice(1).replaceAll("-", " ");

/** How the publisher makes the data available. Standards get their name; a publisher's own interface is just that. */
const FORMAT_LABEL = new Map([
  ["arcgis", "ArcGIS"],
  ["opendatasoft", "Opendatasoft"],
  ["ckan", "CKAN"],
  ["gtfs", "GTFS"],
  ["gbfs", "GBFS"],
  ["udata", "dados.gov.pt"],
]);
export const formatOf = (feed: Feed | undefined) => FORMAT_LABEL.get(feed?.format ?? "") ?? "Own API";
export const throughOf = (feed: Feed | undefined) => (FORMAT_LABEL.has(feed?.format ?? "") ? `through ${formatOf(feed)}` : "through the publisher’s own API");

export type UpdatesBucket = "live" | "daily" | "slower";
export const UPDATES: { id: UpdatesBucket; label: string }[] = [
  { id: "live", label: "Several times an hour" },
  { id: "daily", label: "Hourly to daily" },
  { id: "slower", label: "Less often than daily" },
];
const updatesOf = (seconds: number): UpdatesBucket => (seconds < 3600 ? "live" : seconds <= 86_400 ? "daily" : "slower");

export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
export const publisherHref = (id: string) => `/publisher/?id=${encodeURIComponent(id)}`;
export const licenceHref = (id: string) => `/licence/?id=${encodeURIComponent(id)}`;

/** A web address a person can open, or nothing: the page never links another scheme. */
export function openableUrl(value: string | undefined) {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
}

export type Tone = "ok" | "warn" | "bad";

/** Freshness from the product row, cross-checked against the feed's clock. */
export interface Freshness {
  tone: Tone;
  label: string;
}

export function freshness(product: Product, feed: Feed | undefined): Freshness {
  if (product.status === "failed") return { tone: "bad", label: "Last rebuild failed" };
  if (product.stale) return { tone: "warn", label: "Late" };
  if (feed?.lastSuccessAt && feed.staleAfterSeconds) {
    const age = (Date.now() - new Date(feed.lastSuccessAt).getTime()) / 1000;
    if (age > feed.staleAfterSeconds) return { tone: "warn", label: "Late" };
  }
  return { tone: "ok", label: "Current" };
}

/** The feed a product came from, for the freshness its own collection decides. */
function feedOf(feeds: Feed[], product: Product): Feed | undefined {
  return feeds.find((feed) => feed.id === product.feedId);
}

export interface LabelledProduct {
  product: Product;
  label: string;
}

export interface Dataset {
  /** The dataset's key: what its page is addressed by. */
  id: string;
  /** The feeds that read it, the one that last succeeded first. */
  feeds: Feed[];
  title: string;
  description: string;
  publisher: Term;
  topics: string[];
  format: string;
  cadence: number;
  updates: UpdatesBucket;
  roles: Role[];
  licence: Term;
  updatedAt: string | undefined;
  rows: number;
  tone: Tone;
  /** Every table is empty because the source currently lists nothing; it is still collected. */
  empty: boolean;
  products: LabelledProduct[];
}

export interface Publisher extends Term {
  datasets: Dataset[];
  topics: Map<string, number>;
  hosts: Map<string, string>;
  licences: Map<string, Term>;
}

/** One licence and everything served under it. */
export interface Licence extends Term {
  datasets: Dataset[];
  publishers: Map<string, Term>;
  topics: Map<string, number>;
}

/** One dataset, with every feed that reads part of it and everything those feeds serve. */
export function buildDatasets(products: Product[], feeds: Feed[]): Dataset[] {
  const byFeed = new Map<string, Product[]>();
  for (const product of products) byFeed.set(product.feedId, [...(byFeed.get(product.feedId) ?? []), product]);
  const grouped = new Map<string, Feed[]>();
  for (const feed of feeds) {
    if (!byFeed.has(feed.id)) continue;
    grouped.set(feed.dataset.id, [...(grouped.get(feed.dataset.id) ?? []), feed]);
  }
  const datasets: Dataset[] = [];
  for (const [id, members] of grouped) {
    const feed = members[0]!;
    const items = members.flatMap((member) => byFeed.get(member.id) ?? []);
    const cadence = Math.min(...items.map((product) => product.cadenceSeconds ?? Number.POSITIVE_INFINITY));
    const tones = items.map((product) => freshness(product, feedOf(members, product)).tone);
    datasets.push({
      id,
      feeds: members,
      title: feed.dataset.title,
      description: feed.dataset.description ?? feed.description,
      publisher: feed.dataset.publisher,
      topics: feed.dataset.topics,
      format: formatOf(feed),
      cadence,
      updates: updatesOf(cadence),
      roles: [...new Set(items.map((product) => product.role))],
      licence: feed.dataset.licence,
      updatedAt: items
        .map((product) => product.updatedAt)
        .filter(Boolean)
        .sort()
        .at(-1),
      rows: items.reduce((sum, product) => sum + (product.rowCount ?? 0), 0),
      tone: tones.includes("bad") ? "bad" : tones.includes("warn") ? "warn" : "ok",
      empty: items.every((product) => product.rowCount === 0),
      // Empty tables go last within a dataset, keeping the source's order otherwise.
      products: labelled(feed, items).sort((a, b) => Number(a.product.rowCount === 0) - Number(b.product.rowCount === 0)),
    });
  }
  return datasets;
}

/** Datasets the source currently leaves empty sort after the rest, whatever the order. */
export const emptyLast = (a: Dataset, b: Dataset) => Number(a.empty) - Number(b.empty);

export function buildPublishers(datasets: Dataset[]): Publisher[] {
  const publishers = new Map<string, Publisher>();
  for (const dataset of datasets) {
    const publisher: Publisher = publishers.get(dataset.publisher.id) ?? { ...dataset.publisher, datasets: [], topics: new Map(), hosts: new Map(), licences: new Map() };
    publisher.datasets.push(dataset);
    for (const topic of dataset.topics) publisher.topics.set(topic, (publisher.topics.get(topic) ?? 0) + 1);
    publisher.licences.set(dataset.licence.id, dataset.licence);
    const source = openableUrl(dataset.feeds.find((feed) => feed.sourceUrl)?.sourceUrl);
    if (source && !publisher.hosts.has(source.hostname)) publisher.hosts.set(source.hostname, source.href);
    publishers.set(publisher.id, publisher);
  }
  return [...publishers.values()].sort((a, b) => b.datasets.length - a.datasets.length || a.name.localeCompare(b.name));
}

export function buildLicences(datasets: Dataset[]): Licence[] {
  const licences = new Map<string, Licence>();
  for (const dataset of datasets) {
    const licence: Licence = licences.get(dataset.licence.id) ?? { ...dataset.licence, datasets: [], publishers: new Map(), topics: new Map() };
    licence.datasets.push(dataset);
    licence.publishers.set(dataset.publisher.id, dataset.publisher);
    for (const topic of dataset.topics) licence.topics.set(topic, (licence.topics.get(topic) ?? 0) + 1);
    licences.set(licence.id, licence);
  }
  return [...licences.values()].sort((a, b) => b.datasets.length - a.datasets.length || a.name.localeCompare(b.name));
}

export const productCount = (datasets: Dataset[]) => datasets.reduce((sum, dataset) => sum + dataset.products.length, 0);
export const topicsOf = (group: { topics: Map<string, number> }) => [...group.topics.entries()].sort((a, b) => b[1] - a[1]).map(([topic]) => topicLabel(topic));

/* ---------- Product labels inside a dataset ---------- */

const ROLE_ORDER: Role[] = ["current-state", "time-series", "event-log", "reference", "summary"];
const ROLE_FALLBACK = { reference: "All records", "current-state": "Current records", "event-log": "Events", "time-series": "Series", summary: "Summary" } satisfies {
  [role in Role]: string;
};
/** Units that say nothing about what a series measures. */
const EMPTY_UNIT = /^(unknown|value|unknown-source-unit|não aplicável.*|not applicable.*|-)$/i;

function fallbackLabel(product: Product) {
  if (product.role !== "time-series") return ROLE_FALLBACK[product.role];
  const unit = product.schema.fields.find((field) => field.id === "value")?.unit?.trim();
  return unit && !EMPTY_UNIT.test(unit) ? unit : ROLE_FALLBACK[product.role];
}

/** Short labels: strip the prefix sources put on every derived series; the dataset's own name falls back to the role. */
function labelled(feed: Feed, products: Product[]): LabelledProduct[] {
  const titles = products.map((product) => product.title);
  const prefix = sharedPrefix(titles);
  const head = prefix.replace(SEPARATOR_END, "");
  return products
    .map((product) => {
      let label = product.title;
      if (prefix && product.title.startsWith(prefix) && product.title.length > prefix.length) label = capitalize(product.title.slice(prefix.length));
      else if (head && product.title === head && products.length > 1) label = fallbackLabel(product);
      else if (product.title === feed.title || product.title.length > 90 || titles.filter((title) => title === product.title).length > 1) label = fallbackLabel(product);
      return { product, label };
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.product.role) - ROLE_ORDER.indexOf(b.product.role) || a.label.localeCompare(b.label));
}

/**
 * The words every product of a dataset repeats, with the punctuation that ends them: "Parliament
 * XVII: " before committees, sittings and attendance. Dropping it is what keeps a row of products to
 * one line each without cutting anything off — the card already carries the dataset's own title, and
 * each row's tooltip carries the product's. Sources separate the prefix in several ways, so each is
 * tried in turn and the first one every title shares wins.
 */
const SEPARATORS = [" — ", " – ", ": ", " · ", " - "] as const;
const SEPARATOR_END = /(\s[—–·-]\s|:\s)$/u;

function sharedPrefix(titles: string[]) {
  if (titles.length < 2) return "";
  for (const separator of SEPARATORS) {
    // A title without the separator counts as its own head, so a product named after the whole
    // dataset still shares it and falls back to its role below.
    const heads = titles.map((title) => (title.includes(separator) ? title.slice(0, title.indexOf(separator)) : title));
    const head = heads.find((_, index) => titles[index]?.includes(separator));
    if (head === undefined || head.length < 3) continue;
    if (!heads.every((each) => each === head)) continue;
    return `${head}${separator}`;
  }
  return "";
}

/** A label that lost its prefix starts mid-sentence: "committee meetings" reads as a fragment. */
function capitalize(label: string) {
  const first = label.slice(0, 1);
  return first.toLocaleUpperCase("pt-PT") === first ? label : `${first.toLocaleUpperCase("pt-PT")}${label.slice(1)}`;
}

/* ---------- Shared reads ---------- */

export const fetchProducts = () => apiGet<{ data: Product[] }>("/api/products").then((result) => result.data);
export const fetchFeeds = () => apiGet<{ data: Feed[] }>("/api/feeds").then((result) => result.data);
