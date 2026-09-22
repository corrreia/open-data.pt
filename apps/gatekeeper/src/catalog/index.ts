import type { CatalogDescription, ExampleFeed, SourceConfig } from "@open-data-pt/contract";

import type { PublisherInputs, StreamingTransformer } from "../library";

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

/** Every dataset, held or not, by key, with the key of the publisher whose folder it is in. */
export const DATASETS: ReadonlyMap<string, DatasetDefinition & { publisher: string }> = new Map(
  PUBLISHER_FOLDERS.flatMap((folder) => folder.datasets.map(({ id, dataset }) => [id, { ...dataset, publisher: folder.id }] as const)),
);

/** Whether we may republish a publisher's data: every one but those held for permission. */
export function publisherEnabled(id: string): boolean {
  return PUBLISHERS.get(id)?.enabled !== false;
}

/** Whether a dataset's feeds may be installed: every one but those of a held publisher. */
export function datasetEnabled(id: string): boolean {
  const dataset = DATASETS.get(id);
  return dataset !== undefined && publisherEnabled(dataset.publisher);
}

/** Every feed every folder declares, held or not, each carrying the key of the dataset it is written in. */
export const FEEDS: readonly ExampleFeed[] = PUBLISHER_FOLDERS.flatMap((folder) =>
  folder.datasets.flatMap(({ id, dataset }) => dataset.feeds.map((feed): ExampleFeed => ({ ...feed, dataset: id }))),
);

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

/** The hosts a feed's configuration names: its `host`, and the host of any URL it carries. */
function hostsNamed(config: SourceConfig): string[] {
  return Object.entries(config).flatMap(([key, value]) => {
    if (key === "host") return [value];
    return /^https?:\/\//.test(value) ? [new URL(value).hostname] : [];
  });
}

/**
 * What the publisher folders bring one library: the hosts their feeds name —
 * the only ones it may fetch, so a new publisher on a shared format never edits
 * the format — and the translators they bring for it. Two publishers bringing a
 * translator under one name is a mistake, refused when the Worker starts.
 */
export function publisherInputs(source: string): PublisherInputs {
  const hosts = new Set(FEEDS.filter((feed) => feed.config.source === source).flatMap((feed) => hostsNamed(feed.config)));
  const transformers = new Map<string, StreamingTransformer>();
  for (const folder of PUBLISHER_FOLDERS) {
    for (const [name, transformer] of Object.entries(folder.transformers?.[source] ?? {})) {
      if (transformers.has(name)) throw new Error(`Two publishers bring a ${source} translator called ${name}`);
      transformers.set(name, transformer);
    }
  }
  return { hosts: [...hosts].toSorted(), transformers };
}
