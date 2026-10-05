// Datasets built from the product and feed lists, the facets they filter by, and the words the catalog uses.

import { topicName } from "@open-data-pt/api";
import { CATALOG } from "../text/catalog";
import { apiGet } from "./api";
import { LOCALE, localHref } from "./locale";
import type { Feed, Product, Role, Term } from "./types";

export interface RoleMeta {
  label: string;
  short: string;
  description: string;
}

export const ROLE = CATALOG.roles satisfies { [role in Role]: RoleMeta };

export const topicLabel = (topic: string) => topicName(topic, LOCALE);

/**
 * Text as search compares it: without case or accents, so "agua" finds "Água" and "eletricidade"
 * finds "Electricidade". Portuguese is written with and without them, before and after the 1990
 * spelling agreement, and nobody types every one into a search box.
 */
export const searchable = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-PT");

/** The words of a search, each of which a match has to contain. */
export const searchWords = (query: string) => searchable(query).split(/\s+/).filter(Boolean);

/**
 * Everything a dataset can be found by, in both languages whichever the page is in: someone on the
 * English page may well search in Portuguese. The feed is never shown, but its name is often what
 * someone searches for: "fuel prices" finds the station prices.
 */
export function listingHaystack(listing: Listing): string {
  const { product, feed, title, description, publisher, topics, format } = listing;
  const topicNames = topics.flatMap((topic) => [topicName(topic, "en"), topicName(topic, "pt")]);
  return searchable([title, description, product.slug, feed.title, feed.description, publisher.name, format, ...topicNames].join(" "));
}

/** How the publisher makes the data available. Standards get their name; a publisher's own interface is just that. */
const FORMAT_LABEL = new Map([
  ["arcgis", "ArcGIS"],
  ["opendatasoft", "Opendatasoft"],
  ["ckan", "CKAN"],
  ["gtfs", "GTFS"],
  ["gbfs", "GBFS"],
  ["udata", "dados.gov.pt"],
]);
export const formatOf = (feed: Feed | undefined) => FORMAT_LABEL.get(feed?.format ?? "") ?? CATALOG.ownApi;
export const throughOf = (feed: Feed | undefined) => (FORMAT_LABEL.has(feed?.format ?? "") ? CATALOG.through(formatOf(feed)) : CATALOG.throughOwnApi);

export type UpdatesBucket = "live" | "daily" | "slower";
export const UPDATES: { id: UpdatesBucket; label: string }[] = [
  { id: "live", label: CATALOG.updates.live },
  { id: "daily", label: CATALOG.updates.daily },
  { id: "slower", label: CATALOG.updates.slower },
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
export const publisherHref = (id: string) => localHref(`/publisher/?id=${encodeURIComponent(id)}`);
export const licenceHref = (id: string) => localHref(`/licence/?id=${encodeURIComponent(id)}`);

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
  if (product.status === "failed") return { tone: "bad", label: CATALOG.rebuildFailed };
  if (product.stale) return { tone: "warn", label: CATALOG.late };
  if (feed?.lastSuccessAt && feed.staleAfterSeconds) {
    const age = (Date.now() - new Date(feed.lastSuccessAt).getTime()) / 1000;
    if (age > feed.staleAfterSeconds) return { tone: "warn", label: CATALOG.late };
  }
  return { tone: "ok", label: CATALOG.current };
}

/**
 * One table or series as the catalog lists it: what it is, whose it is and
 * under what terms, how often it changes, and how fresh it is. The feed it
 * comes from is how it is collected, which the catalog never shows: a feed's
 * terms and topics are every one of its products'.
 */
export interface Listing {
  /** The product's slug: its page and its API address. */
  id: string;
  product: Product;
  feed: Feed;
  title: string;
  description: string;
  publisher: Term;
  topics: string[];
  licence: Term;
  format: string;
  role: Role;
  cadence: number;
  updates: UpdatesBucket;
  updatedAt: string | undefined;
  rows: number;
  tone: Tone;
  /** Empty because the source currently lists nothing; it is still collected. */
  empty: boolean;
}

export interface Publisher extends Term {
  listings: Listing[];
  topics: Map<string, number>;
  hosts: Map<string, string>;
  licences: Map<string, Term>;
}

/** One licence and everything served under it. */
export interface Licence extends Term {
  listings: Listing[];
  publishers: Map<string, Term>;
  topics: Map<string, number>;
}

/** Every table and series with the feed it comes from, which gives it its publisher, terms and topics. */
export function buildListings(products: Product[], feeds: Feed[]): Listing[] {
  const byId = new Map(feeds.map((feed) => [feed.id, feed]));
  return products.flatMap((product): Listing[] => {
    const feed = byId.get(product.feedId);
    if (!feed) return [];
    const cadence = product.cadenceSeconds ?? Number.POSITIVE_INFINITY;
    return [
      {
        id: product.slug,
        product,
        feed,
        title: product.title,
        description: product.description,
        publisher: feed.publisher,
        topics: feed.topics,
        licence: feed.licence,
        format: formatOf(feed),
        role: product.role,
        cadence,
        updates: updatesOf(cadence),
        updatedAt: product.updatedAt || undefined,
        rows: product.rowCount ?? 0,
        tone: freshness(product, feed).tone,
        empty: product.rowCount === 0,
      },
    ];
  });
}

/** Tables and series the source currently leaves empty sort after the rest, whatever the order. */
export const emptyLast = (a: Listing, b: Listing) => Number(a.empty) - Number(b.empty);

export function buildPublishers(listings: Listing[]): Publisher[] {
  const publishers = new Map<string, Publisher>();
  for (const listing of listings) {
    const publisher: Publisher = publishers.get(listing.publisher.id) ?? { ...listing.publisher, listings: [], topics: new Map(), hosts: new Map(), licences: new Map() };
    publisher.listings.push(listing);
    for (const topic of listing.topics) publisher.topics.set(topic, (publisher.topics.get(topic) ?? 0) + 1);
    publisher.licences.set(listing.licence.id, listing.licence);
    const source = openableUrl(listing.feed.sourceUrl);
    if (source && !publisher.hosts.has(source.hostname)) publisher.hosts.set(source.hostname, source.href);
    publishers.set(publisher.id, publisher);
  }
  return [...publishers.values()].sort((a, b) => b.listings.length - a.listings.length || a.name.localeCompare(b.name));
}

export function buildLicences(listings: Listing[]): Licence[] {
  const licences = new Map<string, Licence>();
  for (const listing of listings) {
    const licence: Licence = licences.get(listing.licence.id) ?? { ...listing.licence, listings: [], publishers: new Map(), topics: new Map() };
    licence.listings.push(listing);
    licence.publishers.set(listing.publisher.id, listing.publisher);
    for (const topic of listing.topics) licence.topics.set(topic, (licence.topics.get(topic) ?? 0) + 1);
    licences.set(licence.id, licence);
  }
  return [...licences.values()].sort((a, b) => b.listings.length - a.listings.length || a.name.localeCompare(b.name));
}

export const topicsOf = (group: { topics: Map<string, number> }) => [...group.topics.entries()].sort((a, b) => b[1] - a[1]).map(([topic]) => topicLabel(topic));

/**
 * A title without the publisher's name, for where their name is already the
 * heading: "Carris Metropolitana lines" under Carris Metropolitana is "Lines".
 * The short form of a name ("DGEG" of "DGEG · Direção-Geral de Energia e
 * Geologia") counts too.
 */
export function withoutPublisher(listing: Listing): string {
  const names = [listing.publisher.name, listing.publisher.name.split(" · ")[0] ?? ""].filter((name) => name.length > 1);
  for (const name of names) {
    if (listing.title.toLocaleLowerCase("pt-PT").startsWith(`${name.toLocaleLowerCase("pt-PT")} `)) {
      const rest = listing.title.slice(name.length + 1);
      return `${rest.slice(0, 1).toLocaleUpperCase("pt-PT")}${rest.slice(1)}`;
    }
  }
  return listing.title;
}

/* ---------- Shared reads ---------- */

export const fetchProducts = () => apiGet<{ data: Product[] }>("/api/products").then((result) => result.data);
export const fetchFeeds = () => apiGet<{ data: Feed[] }>("/api/feeds").then((result) => result.data);
