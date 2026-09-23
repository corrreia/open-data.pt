import type { ExampleFeed, SourceConfig } from "@open-data-pt/contract";

import type { FeedFunctions, LibraryDeployment, RunnableFeed } from "#/library";
import type { PublisherSources } from "#/publisher-client";

import type { Licence } from "./licences";
import type { Topic } from "./topics";

/*
 * What a publisher folder declares. A publisher is a folder under
 * `src/publishers/`, named for their key: its `index.ts` exports `PUBLISHER`,
 * its logo sits beside it as `logo.svg` or `logo.png`, the code that reads their
 * own API (when they have one) is a library folder beside that, and every
 * dataset of theirs is a folder under `datasets/`: its `index.ts` exports
 * `DATASET`, and every other file in it is one feed, exporting `FEED`.
 * A publisher whose data a shared format cannot read as it is keeps its own
 * translator in their folder, and their feed file calls it.
 *
 * Nothing here repeats what the folders already say: a publisher's key is its
 * folder's name, a dataset's key is its publisher's key and its file's name,
 * and a feed's dataset is the file it is written in.
 */

/** Who made the data: never the portal it was read from. */
export interface PublisherDefinition {
  /** The name as a heading shows it: an acronym and what it stands for, or the operator's name. */
  name: string;
  /** Their own site, for people: often not where their data is read from. */
  url?: string;
  /**
   * Where their data is read from: the only hosts their feeds may reach. Each
   * feed's `fetch` is a client bound to these, which names open-data.pt in
   * every request and adds anything the publisher asked of us, such as a query
   * parameter; a request or a redirect anywhere else is refused.
   */
  sources: PublisherSources;
  /** Their mark's extension, when `logo.svg` or `logo.png` sits in the folder. Absent, their initials stand in for it. */
  logo?: "svg" | "png";
  /**
   * Whether we may republish what they publish. Absent means we may. `false`
   * holds every dataset and feed of theirs out of the catalog, so nothing of
   * theirs is polled or served, while their folder and their code stay and a
   * comment says what we are waiting for. Lifting a hold is one word.
   */
  enabled?: boolean;
}

/** How often a feed runs, how long it may take, how much it may read, and whether its changes are history. */
export type FeedPolicy = ExampleFeed["policy"];

/**
 * One feed, in its own file beside its dataset's `index.ts`: what it is, how
 * often it runs, and the functions that read it — `fetch`, `backfill` when the
 * source keeps history, and `transform` — each calling whatever shared code it
 * needs. `config` is what the feed's identity and history hang on: it never
 * changes once merged. It carries no `source`; `defineFeed` takes the library.
 */
export interface FeedDefinition<C, M extends object = never> extends Omit<ExampleFeed, "dataset" | "config">, FeedFunctions<C, M> {
  config: SourceConfig;
}

/**
 * A feed file's export, defined against the library whose shared code it
 * calls: that library works out its identity, and hands its functions what the
 * Worker gave it (`context.library`).
 */
export function defineFeed<E, C, M extends object = never>(library: LibraryDeployment<E, C>, feed: FeedDefinition<C, M>): RunnableFeed {
  // SAFETY: a feed's transform only ever receives the metadata its own fetch returned (`feedCollector`), so erasing
  // `M` here, to let one list hold every feed, loses nothing the Worker relies on.
  return { ...feed, config: { source: library.source, ...feed.config } } as RunnableFeed;
}

/** One publisher's body of data, and the feeds that read it. */
export interface DatasetDefinition {
  title: string;
  description: string;
  /** The terms the publisher states for it, or `source-terms` when they state none. */
  licence: Licence;
  /** How the publisher asks to be credited, when they say. */
  attribution?: string;
  /** What the catalog groups and filters by. */
  topics: readonly Topic[];
}
