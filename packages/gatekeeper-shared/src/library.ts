import { GatekeeperError, hashSourceConfig, type FeedKindDescription, type NormalizedCollector, type ResolvedFeed, type SourceConfig, type TransformContext } from "./index";

/**
 * A Worker is wiring. It names the libraries it carries, hands each one its
 * vars and secrets, and routes every feed to one of them on the `source` key
 * its configuration carries. Parsing happens in the library, never here.
 */
export interface GatekeeperLibrary {
  /** Every feed kind this library declares, under its own unprefixed names. */
  kinds: readonly FeedKindDescription[];
  /** The collection this library performs, with the Worker's deployment values already bound. */
  collector: (config: SourceConfig) => NormalizedCollector;
}

/** The libraries one topic Worker carries, by the `source` value that selects them. */
export type GatekeeperLibraries = ReadonlyMap<string, GatekeeperLibrary>;

export interface TopicOptions {
  /** The Worker's own kind, which is its topic: `mobility`, `energy`, `telecom`, … */
  gatekeeperKind: string;
  libraries: GatekeeperLibraries;
}

/** The routing key every example configuration carries; it names the library, not the publisher. */
export const SOURCE_KEY = "source";

/**
 * Kinds are prefixed `<library>:<kind>` so two libraries in one Worker can both
 * declare a `dataset` without colliding.
 */
export function topicFeedKinds(libraries: GatekeeperLibraries): FeedKindDescription[] {
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
  library: GatekeeperLibrary;
  /** The configuration the library sees: everything but the routing key. */
  rest: SourceConfig;
}

function route(config: SourceConfig, options: TopicOptions): Routed {
  const source = config[SOURCE_KEY];
  if (!source) throw new GatekeeperError(`${options.gatekeeperKind} feeds require ${SOURCE_KEY}`, "invalid-config");
  const library = options.libraries.get(source);
  if (!library) {
    throw new GatekeeperError(`${options.gatekeeperKind} does not carry the ${source} library`, "invalid-config");
  }
  return { source, library, rest: libraryConfig(config) };
}

/**
 * Resolution through one library, re-stamped for the Worker: the routing key
 * stays in the canonical configuration (the kernel hands it back on every
 * collection, and it is what routes that collection), and the resource key and
 * feed kind are scoped by the Worker and the library so nothing collides.
 */
export async function resolveTopicFeed(config: SourceConfig, options: TopicOptions): Promise<ResolvedFeed> {
  const { source, library, rest } = route(config, options);
  const inner = await library.collector(rest).resolve(rest);
  const canonical: SourceConfig = { ...inner.config, [SOURCE_KEY]: source };
  const resolved: ResolvedFeed = {
    config: canonical,
    configHash: await hashSourceConfig(canonical),
    resourceKey: `${options.gatekeeperKind}:${inner.resourceKey}`,
    kind: `${source}:${inner.kind}`,
    semantics: inner.semantics,
  };
  if (inner.history) resolved.history = inner.history;
  return resolved;
}

/** The library's own collector, with resolution re-stamped and the routing key kept out of the normalizer's sight. */
export function topicCollector(config: SourceConfig, options: TopicOptions): NormalizedCollector {
  const { library, rest } = route(config, options);
  const inner = library.collector(rest);
  const normalize = inner.normalize;
  const withoutRoutingKey = (context: TransformContext): TransformContext => ({ ...context, feed: { ...context.feed, config: rest } });
  return {
    normalizer: inner.normalizer,
    resolve: (value) => resolveTopicFeed(value, options),
    source: inner.source,
    normalize:
      normalize.kind === "streaming"
        ? { kind: "streaming", transform: (body, context) => normalize.transform(body, withoutRoutingKey(context)) }
        : { kind: "buffered", transform: (bytes, context) => normalize.transform(bytes, withoutRoutingKey(context)) },
  };
}
