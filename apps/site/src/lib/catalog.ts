// Datasets built from the product and feed lists, the facets they filter by, and the words the catalog uses.

import { apiGet } from "./api";
import type { Feed, Product, Role, Term } from "./types";

export interface RoleMeta {
  label: string;
  short: string;
  description: string;
  badge: "green" | "blue" | "orange" | "purple" | "teal";
}

export const ROLE = {
  reference: {
    label: "Reference",
    short: "Reference",
    badge: "green",
    description: "A complete, slow-changing catalog. Every collection replaces the whole set and keeps the previous version.",
  },
  "current-state": {
    label: "Current state",
    short: "Current",
    badge: "blue",
    description: "The latest known state of each entity. Replaced on every collection; old versions expire quickly.",
  },
  "event-log": { label: "Events", short: "Events", badge: "orange", description: "Things that happened, with corrections and retractions retained by knowledge time." },
  "time-series": {
    label: "Time series",
    short: "Series",
    badge: "purple",
    description: "Numeric measurements keyed by series and event time. Points can be corrected later; corrections are logged.",
  },
  summary: { label: "Summary", short: "Summary", badge: "teal", description: "A derived aggregate rebuilt from the same acquisition as its source product." },
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
export const throughOf = (feed: Feed | undefined) => (FORMAT_LABEL.has(feed?.format ?? "") ? `through ${formatOf(feed)}` : "through the publisher's own API");

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
  if (product.stale || product.status === "stale") return { tone: "warn", label: "Late" };
  if (feed?.lastSuccessAt && feed.staleAfterSeconds) {
    const age = (Date.now() - new Date(feed.lastSuccessAt).getTime()) / 1000;
    if (age > feed.staleAfterSeconds) return { tone: "warn", label: "Late" };
  }
  return { tone: "ok", label: "Current" };
}

export interface LabelledProduct {
  product: Product;
  label: string;
}

export interface Dataset {
  feed: Feed;
  title: string;
  publisher: Term;
  topics: string[];
  format: string;
  cadence: number;
  updates: UpdatesBucket;
  roles: Role[];
  licence: Term | undefined;
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

/** One dataset per feed that serves at least one product. */
export function buildDatasets(products: Product[], feeds: Feed[]): Dataset[] {
  const byFeed = new Map<string, Product[]>();
  for (const product of products) byFeed.set(product.feedId, [...(byFeed.get(product.feedId) ?? []), product]);
  const datasets: Dataset[] = [];
  for (const feed of feeds) {
    const items = byFeed.get(feed.id);
    if (!items) continue;
    const cadence = Math.min(...items.map((product) => product.cadenceSeconds ?? Number.POSITIVE_INFINITY));
    const tones = items.map((product) => freshness(product, feed).tone);
    datasets.push({
      feed,
      title: feed.title,
      publisher: feed.publisher,
      topics: feed.topics ?? [],
      format: formatOf(feed),
      cadence,
      updates: updatesOf(cadence),
      roles: [...new Set(items.map((product) => product.role))],
      licence: items.find((product) => product.licence)?.licence ?? undefined,
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
    if (dataset.licence) publisher.licences.set(dataset.licence.id, dataset.licence);
    const source = openableUrl(dataset.feed.sourceUrl);
    if (source && !publisher.hosts.has(source.hostname)) publisher.hosts.set(source.hostname, source.href);
    publishers.set(publisher.id, publisher);
  }
  return [...publishers.values()].sort((a, b) => b.datasets.length - a.datasets.length || a.name.localeCompare(b.name));
}

export function buildLicences(datasets: Dataset[]): Licence[] {
  const licences = new Map<string, Licence>();
  for (const dataset of datasets) {
    if (!dataset.licence) continue;
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
  return products
    .map((product) => {
      let label = product.title;
      if (prefix && product.title.startsWith(`${prefix} — `)) label = product.title.slice(prefix.length + 3);
      else if (prefix && product.title === prefix && products.length > 1) label = fallbackLabel(product);
      else if (product.title === feed.title || product.title.length > 90 || titles.filter((title) => title === product.title).length > 1) label = fallbackLabel(product);
      return { product, label };
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.product.role) - ROLE_ORDER.indexOf(b.product.role) || a.label.localeCompare(b.label));
}

function sharedPrefix(titles: string[]) {
  const heads = titles.filter((title) => title.includes(" — ")).map((title) => title.slice(0, title.indexOf(" — ")));
  if (heads.length === 0) return "";
  return heads.every((head) => head === heads[0]) ? (heads[0] ?? "") : "";
}

/* ---------- Shared reads ---------- */

export const fetchProducts = () => apiGet<{ data: Product[] }>("/api/products").then((result) => result.data);
export const fetchFeeds = () => apiGet<{ data: Feed[] }>("/api/feeds").then((result) => result.data);
