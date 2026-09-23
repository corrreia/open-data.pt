import {
  GatekeeperError,
  hashSourceConfig,
  sourceValidator,
  type ExampleFeed,
  type FeedKindDescription,
  type HistoryCursor,
  type JsonObject,
  type NormalizedCollector,
  type ResolvedFeed,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
  type StreamingTransform,
  type TransformContext,
  type TransformResult,
} from "./index";
import { publisherClient, type PublisherSources } from "./publisher-client";

/**
 * The Gatekeeper Worker is wiring. It carries every library, hands each its
 * vars and secrets, and runs every feed with the functions its own file
 * defines. A library is shared code: its feed kinds, how a feed's identity is
 * worked out, and what its feeds need from the Worker when they run.
 */
export interface GatekeeperLibrary<C = never> {
  /** Every feed kind this library declares, under its own unprefixed names. */
  kinds: readonly FeedKindDescription[];
  /**
   * A feed's canonical identity: its configuration validated, and which kind it
   * is. The resource key it yields is what a feed's history hangs on, so it is
   * the library's, never a feed's to compute.
   */
  resolve: (config: SourceConfig) => ResolvedFeed | Promise<ResolvedFeed>;
  /** What this library's feeds need from the Worker when they run: an origin, the hosts they may fetch, a secret, a bucket. */
  context: C;
}

/** What a feed's `fetch` and `backfill` are handed when the kernel asks for a collection. */
export interface FeedContext<C> {
  /** The feed's canonical configuration, without the routing key. */
  config: SourceConfig;
  /** The source-owned state its last collection left, when it is still this feed's. */
  state: JsonObject | undefined;
  /** The transport validators in that state, for a conditional request. */
  validator: SourceValidator | undefined;
  /** Aborted when the collection's deadline passes. */
  signal: AbortSignal;
  /** The Worker's fetch, aborted with the collection. */
  fetch: typeof fetch;
  /** What the feed's library was given by the Worker. */
  library: C;
  /** The collection's clock. */
  now: () => Date;
}

/**
 * What a fetch found, when its transform needs more than the bytes: a CKAN
 * resource's title, format and coordinate system come from the same catalogue
 * request as its body. The Worker hands `metadata` to the transform of the
 * same collection, and to nothing else.
 */
export interface Described<M extends object> {
  fetch: SourceFetch;
  metadata?: M;
}

/** Source bytes into products, and the name and version of what did it: a change of version is a new normalizer. */
export type FeedTransform<M extends object = never> =
  | {
      normalizer: { id: string; version: string };
      buffered: (bytes: Uint8Array, context: TransformContext, metadata: M | undefined) => TransformResult | Promise<TransformResult>;
    }
  | {
      normalizer: { id: string; version: string };
      streaming: (body: ReadableStream<Uint8Array>, context: TransformContext, metadata: M | undefined) => StreamingTransform | Promise<StreamingTransform>;
    };

/** The functions a feed's own file defines: how it reads now, how it walks back through history, and how its bytes become products. */
export interface FeedFunctions<C, M extends object = never> {
  /** What the source holds now. The kernel runs it every `policy.collection.cadenceSeconds`. */
  fetch: (context: FeedContext<C>) => Promise<SourceFetch | Described<M>>;
  /** One slice of history older than `cursor`. Absent when the source keeps none. */
  backfill?: (context: FeedContext<C>, cursor: HistoryCursor) => Promise<SourceFetch | Described<M>>;
  transform: FeedTransform<M>;
}

/** A feed as the Worker runs it: what the kernel is told about it, and its own functions, whatever their library and metadata. */
export interface RunnableFeed extends Omit<ExampleFeed, "dataset"> {
  fetch: (context: FeedContext<never>) => Promise<SourceFetch | Described<object>>;
  backfill?: (context: FeedContext<never>, cursor: HistoryCursor) => Promise<SourceFetch | Described<object>>;
  transform: FeedTransform;
}

/** The libraries the Worker carries, by the `source` value that selects them. */
export type GatekeeperLibraries = ReadonlyMap<string, GatekeeperLibrary<unknown>>;

/** An R2 bucket a library reads and writes through the Worker. */
export interface R2BucketDeployment {
  binding: string;
  bucketName: string;
}

/**
 * What a library needs from the Worker, and how it is built from the Worker's
 * environment. Its vars are declared here with their values and reach the
 * library through that environment; secrets and buckets are bound to the
 * Worker under the names declared here.
 */
export interface LibraryDeployment<E, C = never> {
  /** The `source` value its examples carry, which is also its directory's name. */
  source: string;
  /** How the library describes itself, in words ("CKAN portals"). */
  name: string;
  /** Vars it reads, with their values. */
  vars: Readonly<Record<string, string>>;
  /** Secret names, set with `wrangler secret put` on the Worker. */
  secrets?: readonly string[];
  r2Buckets?: readonly R2BucketDeployment[];
  /** The CPU limit one collection needs; the Worker takes the largest any library declares. */
  cpuMs?: number;
  /** Builds the library from the Worker's environment and what the publishers it reads bring to it. */
  library: (env: E, publishers: PublisherInputs) => GatekeeperLibrary<C>;
}

/**
 * A streaming translator from one source dialect into products: pure and
 * versioned, reading the source as a byte stream and handing rows out one at a
 * time. A format ships the generic ones; a publisher whose data needs its own
 * keeps it in their folder.
 */
export interface StreamingTransformer {
  readonly id: string;
  readonly version: string;
  transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform>;
}

/**
 * What the publisher folders bring a library, so that a new publisher never has
 * to edit a format: the configurations of every feed that reads through it, for
 * any list a library keeps (MYINFO's operators), and the hosts they name, which
 * are the only ones the library may fetch.
 */
export interface PublisherInputs {
  configs: readonly SourceConfig[];
  hosts: readonly string[];
}

/** A library built with nothing from the publishers: no feed, and no host allowed. */
export const NO_PUBLISHER_INPUTS: PublisherInputs = { configs: [], hosts: [] };

/** One library as the Worker and the tests read it: the code that reads one format or one API, and what it needs. Which feeds it reads is the publisher folders' word. */
export interface Library {
  /** Every library's environment and context differ; `never` and `unknown` let one list hold them all, and `buildLibrary` supplies both. */
  deployment: LibraryDeployment<never, unknown>;
}

/**
 * The library built the way the Worker builds it: its declared vars, then
 * whatever the environment sets over them (a secret, a bucket, an override).
 * The environment is the Worker's, whatever bindings it has; the deployment
 * declares which of them it reads.
 */
export function buildLibrary<E extends object>(
  deployment: LibraryDeployment<never, unknown>,
  env: E,
  publishers: PublisherInputs = NO_PUBLISHER_INPUTS,
): GatekeeperLibrary<unknown> {
  const bound = { ...deployment.vars, ...env };
  // SAFETY: a deployment reads its own declared vars, secrets and buckets from the environment, and this one is
  // built from those declarations; `never` only lets deployments with different environments share a list.
  return deployment.library(bound as never, publishers);
}

/** The routing key every example configuration carries; it names the library, not the publisher. */
export const SOURCE_KEY = "source";

/**
 * Kinds are prefixed `<library>:<kind>` so a `dataset` of one library is never
 * confused with another's.
 */
export function libraryFeedKinds(libraries: GatekeeperLibraries): FeedKindDescription[] {
  return [...libraries].flatMap(([source, library]) => library.kinds.map((kind) => ({ ...kind, kind: `${source}:${kind.kind}` })));
}

/** What a library sees of a feed's configuration: everything the example carries but the routing key. */
export function libraryConfig(config: SourceConfig): SourceConfig {
  const rest: SourceConfig = { ...config };
  delete rest[SOURCE_KEY];
  return rest;
}

interface Routed {
  source: string;
  library: GatekeeperLibrary<unknown>;
  /** The configuration the library sees: everything but the routing key. */
  rest: SourceConfig;
}

function route(config: SourceConfig, libraries: GatekeeperLibraries): Routed {
  const source = config[SOURCE_KEY];
  if (!source) throw new GatekeeperError(`A feed configuration requires ${SOURCE_KEY}`, "invalid-config");
  const library = libraries.get(source);
  if (!library) throw new GatekeeperError(`The Gatekeeper does not carry the ${source} library`, "invalid-config");
  return { source, library, rest: libraryConfig(config) };
}

/**
 * Resolution through one library, re-stamped for the Worker: the routing key
 * stays in the canonical configuration (the kernel hands it back on every
 * collection, and it is what routes that collection), and the resource key and
 * feed kind are scoped by the library so nothing collides. The resource key is
 * `<library>:<library>:<kind>:<digest>`: the outer prefix was once the Worker's
 * own name, and stays the library's so no feed's checkpoint is orphaned.
 */
export async function resolveLibraryFeed(config: SourceConfig, libraries: GatekeeperLibraries): Promise<ResolvedFeed> {
  const { source, library, rest } = route(config, libraries);
  const inner = await library.resolve(rest);
  const canonical: SourceConfig = { ...inner.config, [SOURCE_KEY]: source };
  const resolved: ResolvedFeed = {
    config: canonical,
    configHash: await hashSourceConfig(canonical),
    resourceKey: `${source}:${inner.resourceKey}`,
    kind: `${source}:${inner.kind}`,
    semantics: inner.semantics,
  };
  if (inner.history) resolved.history = inner.history;
  return resolved;
}

/** The library's own collector, with resolution re-stamped and the routing key kept out of the normalizer's sight. */

/** What a collection runs on: the Worker's fetch and clock, or a test's saved responses and fixed time. */
export interface FeedRuntime {
  fetcher?: typeof fetch;
  now?: () => Date;
  /** The publisher's declared sources, which bind the feed's fetch; the Worker always passes them (`runtimeOf`). */
  sources?: PublisherSources;
}

/**
 * One feed's collection, from the functions its own file defines: `fetch` for
 * the live read, `backfill` for a history slice, and `transform`. Its library
 * contributes the identity rule and what the Worker gave it.
 */
export function feedCollector(feed: RunnableFeed, config: SourceConfig, libraries: GatekeeperLibraries, runtime: FeedRuntime = {}): NormalizedCollector {
  const base = runtime.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const fetcher = runtime.sources ? publisherClient(runtime.sources, base) : base;
  const now = runtime.now ?? (() => new Date());
  const { library, rest } = route(config, libraries);
  const transform = feed.transform;
  const withoutRoutingKey = (context: TransformContext): TransformContext => ({ ...context, feed: { ...context.feed, config: rest } });
  // What this collection's fetch described its body with, for this collection's transform only.
  let metadata: object | undefined;
  const settle = (fetched: SourceFetch | Described<object>): SourceFetch => {
    if ("kind" in fetched) {
      metadata = undefined;
      return fetched;
    }
    metadata = fetched.metadata;
    return fetched.fetch;
  };
  // SAFETY: the metadata was returned by this feed's own fetch, whose type its transform was written against (`defineFeed`).
  const described = () => metadata as never;
  return {
    normalizer: transform.normalizer,
    resolve: (value) => resolveLibraryFeed(value, libraries),
    source: async (state, mode, signal) => {
      const context: FeedContext<never> = {
        config: rest,
        state,
        validator: sourceValidator(state),
        signal,
        // A request that sets its own timeout keeps it: whichever of the two ends first aborts it.
        fetch: (input, init) => fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
        // SAFETY: a feed is defined against its own library (`defineFeed`), and the Worker routes it to that library by
        // the `source` key `defineFeed` stamped on it, so this is the context its functions were written for.
        library: library.context as never,
        now,
      };
      if (mode.kind === "live") return settle(await feed.fetch(context));
      if (!feed.backfill) throw new GatekeeperError(`${feed.slug} keeps no history to walk back through`, "invalid-config");
      return settle(await feed.backfill(context, mode.cursor));
    },
    normalize:
      "streaming" in transform
        ? { kind: "streaming", transform: (body, context) => transform.streaming(body, withoutRoutingKey(context), described()) }
        : { kind: "buffered", transform: (bytes, context) => transform.buffered(bytes, withoutRoutingKey(context), described()) },
  };
}
