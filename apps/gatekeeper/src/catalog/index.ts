import type { CatalogDescription, ExampleFeed } from "@open-data-pt/contract";

import type { FeedRuntime, PublisherInputs, RunnableFeed } from "#/library";
import { sourceHosts, type PublisherSources } from "#/publisher-client";

import { PUBLISHER_FOLDERS } from "./folders.generated";
import { LICENCES } from "./licences";
import { TOPICS } from "./topics";

import type { PublisherDefinition } from "./define";

/*
 * The catalog, as the publisher folders declare it. The Worker hands it to the
 * kernel over RPC, which stores it and serves it expanded, so the kernel never
 * imports it and a publisher's new feed redeploys the Gatekeeper alone.
 *
 * This module is imported by the Worker and by tests, never by a library or a
 * feed file: the folders import the libraries' helpers, so a library that
 * imported this back would be a cycle.
 */

/** Every publisher, held or not, by key. */
export const PUBLISHERS: ReadonlyMap<string, PublisherDefinition> = new Map(PUBLISHER_FOLDERS.map((folder) => [folder.id, folder.publisher]));

/** Whether we may republish a publisher's data: every one but those held for permission. */
export function publisherEnabled(id: string): boolean {
  return PUBLISHERS.get(id)?.enabled !== false;
}

/** A feed as the kernel is told about it: plain data, since functions do not cross RPC, and the publisher whose folder lists it. */
function exampleOf(feed: RunnableFeed, publisher: string): ExampleFeed {
  const { fetch: _fetch, backfill: _backfill, transform: _transform, topics, ...data } = feed;
  return { ...data, publisher, topics: [...topics] };
}

/** Every feed every publisher lists, by slug: the functions the Worker runs when the kernel asks for a feed's collection. */
export const RUNNABLE: ReadonlyMap<string, RunnableFeed> = new Map(PUBLISHER_FOLDERS.flatMap((folder) => folder.publisher.feeds.map((feed) => [feed.slug, feed] as const)));

/** Every feed every publisher lists, held or not, each carrying the key of its publisher. */
export const FEEDS: readonly ExampleFeed[] = PUBLISHER_FOLDERS.flatMap((folder) => folder.publisher.feeds.map((feed) => exampleOf(feed, folder.id)));

/** Whether a feed may be installed: every one but those of a publisher held for permission. */
export function feedEnabled(feed: ExampleFeed): boolean {
  return publisherEnabled(feed.publisher);
}

/** What the kernel is told besides the feeds: every publisher we may republish, and the vocabularies the feeds name. */
export const CATALOG: CatalogDescription = {
  publishers: PUBLISHER_FOLDERS.filter((folder) => folder.publisher.enabled !== false).map((folder) => {
    const { enabled: _enabled, feeds: _feeds, ...publisher } = folder.publisher;
    return { id: folder.id, ...publisher };
  }),
  licences: Object.entries(LICENCES).map(([id, licence]) => ({ id, ...licence })),
  topics: Object.entries(TOPICS).map(([id, name]) => ({ id, name })),
};

/**
 * What the publisher folders bring one library: the configurations of every
 * feed that reads through it, and the hosts their publishers declare as
 * sources — the only ones it may fetch, so a new publisher on a shared format
 * never edits the format.
 */
export function publisherInputs(source: string): PublisherInputs {
  const feeds = FEEDS.filter((feed) => feed.config.source === source);
  const hosts = new Set(feeds.flatMap((feed) => sourceHosts(sourcesOf(feed.slug))));
  return { configs: feeds.map((feed) => feed.config), hosts: [...hosts].toSorted() };
}

/** The publisher whose folder lists each feed, by slug. */
const PUBLISHER_OF: ReadonlyMap<string, string> = new Map(FEEDS.map((feed) => [feed.slug, feed.publisher] as const));

/** The hosts a feed may reach, and what its publisher asked every request to carry: its publisher's declared sources. */
export function sourcesOf(slug: string): PublisherSources {
  const publisher = PUBLISHERS.get(PUBLISHER_OF.get(slug) ?? "");
  if (!publisher) throw new Error(`No publisher folder holds ${slug}`);
  return publisher.sources;
}

/** What a feed runs on in the Worker: its publisher's client. Tests add their own fetcher and clock to the same. */
export function runtimeOf(slug: string): FeedRuntime {
  return { sources: sourcesOf(slug) };
}
