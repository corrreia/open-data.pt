import type { CatalogDescription, ExampleFeed } from "@open-data-pt/contract";

import type { FeedRuntime, PublisherInputs, RunnableFeed } from "#/library";
import { sourceHosts, type PublisherSources } from "#/publisher-client";

import { PUBLISHER_FOLDERS } from "./folders.generated";
import { LICENCES } from "./licences";
import { TOPICS } from "./topics";

import type { DatasetDefinition, PublisherDefinition } from "./define";

/*
 * The catalog, as the publisher folders declare it. The Worker hands it to the
 * kernel over RPC, which stores it and serves it expanded, so the kernel never
 * imports it and a publisher's new dataset redeploys the Gatekeeper alone.
 *
 * This module is imported by the Worker and by tests, never by a library or a
 * dataset file: the folders import the libraries' helpers, so a library that
 * imported this back would be a cycle.
 */

/** Every publisher, held or not, by key. */
export const PUBLISHERS: ReadonlyMap<string, PublisherDefinition> = new Map(PUBLISHER_FOLDERS.map((folder) => [folder.id, folder.publisher]));

/** A dataset as the catalog reads it: what its file or folder declares, whose it is, and every feed that reads it. */
export interface CatalogEntry extends DatasetDefinition {
  publisher: string;
  feeds: readonly ExampleFeed[];
}

/** A feed as the kernel is told about it: plain data, since functions do not cross RPC. */
function exampleOf(feed: RunnableFeed, dataset: string): ExampleFeed {
  const { fetch: _fetch, backfill: _backfill, transform: _transform, ...data } = feed;
  return { ...data, dataset };
}

/** Every dataset, held or not, by key, with the key of the publisher whose folder it is in and every feed that reads it. */
export const DATASETS: ReadonlyMap<string, CatalogEntry> = new Map(
  PUBLISHER_FOLDERS.flatMap((folder) =>
    folder.datasets.map(({ id, dataset, feeds }) => [id, { ...dataset, publisher: folder.id, feeds: feeds.map((feed) => exampleOf(feed, id)) }] as const),
  ),
);

/** Whether we may republish a publisher's data: every one but those held for permission. */
export function publisherEnabled(id: string): boolean {
  return PUBLISHERS.get(id)?.enabled !== false;
}

/** Whether a dataset's feeds may be installed: every one but those of a held publisher. */
export function datasetEnabled(id: string): boolean {
  const dataset = DATASETS.get(id);
  return dataset !== undefined && dataset.enabled !== false && publisherEnabled(dataset.publisher);
}

/** Every feed file, by slug: the functions the Worker runs when the kernel asks for a feed's collection. */
export const RUNNABLE: ReadonlyMap<string, RunnableFeed> = new Map(
  PUBLISHER_FOLDERS.flatMap((folder) => folder.datasets.flatMap(({ feeds }) => feeds.map((feed) => [feed.slug, feed] as const))),
);

/** Every feed every folder declares, held or not, each carrying the key of the dataset it is written in. */
export const FEEDS: readonly ExampleFeed[] = [...DATASETS.values()].flatMap((dataset) => dataset.feeds);

/** What the kernel is told: every publisher we may republish, their datasets, and the vocabularies they name. */
export const CATALOG: CatalogDescription = {
  publishers: PUBLISHER_FOLDERS.filter((folder) => folder.publisher.enabled !== false).map((folder) => {
    const { enabled: _enabled, ...publisher } = folder.publisher;
    return { id: folder.id, ...publisher };
  }),
  licences: Object.entries(LICENCES).map(([id, licence]) => ({ id, ...licence })),
  topics: Object.entries(TOPICS).map(([id, name]) => ({ id, name })),
  datasets: [...DATASETS].filter(([id]) => datasetEnabled(id)).map(([id, { feeds: _feeds, topics, ...dataset }]) => ({ id, ...dataset, topics: [...topics] })),
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

/** The publisher whose folder each feed is written in, by slug. */
const PUBLISHER_OF: ReadonlyMap<string, string> = new Map([...DATASETS.values()].flatMap((dataset) => dataset.feeds.map((feed) => [feed.slug, dataset.publisher] as const)));

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
