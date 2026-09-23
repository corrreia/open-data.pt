import {
  buildLibrary,
  feedCollector,
  resolveLibraryFeed,
  type ExampleFeed,
  type FeedRuntime,
  type GatekeeperLibraries,
  type Library,
  type NormalizedCollector,
  type ResolvedFeed,
} from "@open-data-pt/gatekeeper";
import { DATASETS, FEEDS, RUNNABLE, datasetEnabled, publisherInputs, type CatalogEntry, runtimeOf } from "@open-data-pt/gatekeeper/catalog";
import { LIBRARIES, library } from "@open-data-pt/gatekeeper/libraries";

/** Every library the Gatekeeper Worker carries, as `libraries.ts` lists them. */
export const CARRIED: readonly Library[] = LIBRARIES;

/** The names of the carried libraries, in the order the Worker carries them. */
export const CARRIED_NAMES: string[] = CARRIED.map((candidate) => candidate.deployment.source);

/** Every feed one library reads, across every publisher folder, whether or not its publisher is enabled. */
export function feedsOf(name: string): ExampleFeed[] {
  return FEEDS.filter((feed) => feed.config.source === name);
}

/** Every feed the Registry installs: every feed a carried library reads, less the publishers held for permission. */
export const INSTALLED: ExampleFeed[] = FEEDS.filter((feed) => CARRIED_NAMES.includes(feed.config.source ?? "") && datasetEnabled(feed.dataset));

/**
 * One library built the way the Worker builds it: its declared vars, whatever
 * else the caller hands over (secrets), what its publishers bring, and what it
 * reads its source with while a feed is resolved.
 */
export function carriedLibraries(name: string, extra: Record<string, string | undefined> = {}, fetcher?: typeof fetch): GatekeeperLibraries {
  return new Map([[name, buildLibrary(library(name).deployment, extra, publisherInputs(name), fetcher)]]);
}

/** What the publisher folders say about the dataset a feed reads part of: its publisher, its terms, its topics. */
export function datasetOf(feed: ExampleFeed): CatalogEntry {
  const dataset = DATASETS.get(feed.dataset);
  if (!dataset) throw new Error(`${feed.slug} names an unknown dataset: ${feed.dataset}`);
  return dataset;
}

/**
 * One feed's collection, run the way the Worker runs it — its identity worked
 * out by its library, then its own functions — against a test's fetcher, so no
 * test reaches the network.
 */
export async function feedCollection(
  slug: string,
  runtime: FeedRuntime = {},
  extra: Record<string, string | undefined> = {},
): Promise<{ resolved: ResolvedFeed; collector: NormalizedCollector }> {
  const feed = RUNNABLE.get(slug);
  if (!feed) throw new Error(`No feed file defines ${slug}`);
  const source = feed.config.source ?? "";
  const libraries = carriedLibraries(source, extra);
  const resolved = await resolveLibraryFeed(feed.config, libraries);
  // Fixtures answer at once, so a host's interval would only slow the test: every other rule of its sources holds.
  const fixture: FeedRuntime = {};
  const sources = runtimeOf(slug).sources;
  if (sources) fixture.sources = sources.map((each) => (each instanceof Object ? { ...each, minIntervalSeconds: 0 } : each));
  return { resolved, collector: feedCollector(feed, resolved.config, libraries, { ...fixture, ...runtime }) };
}
