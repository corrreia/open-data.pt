import { GatekeeperError, hashSourceConfig, type FeedKindDescription, type NormalizedCollector, type ResolvedFeed, type SourceConfig, type TransformContext } from "./index";

/**
 * The Gatekeeper Worker is wiring. It carries every library, hands each its
 * vars and secrets, and routes every feed to one of them on the `source` key
 * its configuration carries. Parsing happens in the library, never here.
 */
export interface GatekeeperLibrary {
  /** Every feed kind this library declares, under its own unprefixed names. */
  kinds: readonly FeedKindDescription[];
  /** The collection this library performs, with the Worker's deployment values already bound. */
  collector: (config: SourceConfig) => NormalizedCollector;
}

/** The libraries the Worker carries, by the `source` value that selects them. */
export type GatekeeperLibraries = ReadonlyMap<string, GatekeeperLibrary>;

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
export interface LibraryDeployment<E> {
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
  /** Builds the library from the Worker's environment. */
  library: (env: E) => GatekeeperLibrary;
}

/** One library as the Worker and the tests read it: the code that reads one format or one API, and what it needs. Which feeds it reads is the publisher folders' word. */
export interface Library {
  /** Every library's environment differs; `never` lets one list hold them all, and `buildLibrary` supplies it. */
  deployment: LibraryDeployment<never>;
}

/**
 * The library built the way the Worker builds it: its declared vars, then
 * whatever the environment sets over them (a secret, a bucket, an override).
 * The environment is the Worker's, whatever bindings it has; the deployment
 * declares which of them it reads.
 */
export function buildLibrary<E extends object>(deployment: LibraryDeployment<never>, env: E): GatekeeperLibrary {
  const bound = { ...deployment.vars, ...env };
  // SAFETY: a deployment reads its own declared vars, secrets and buckets from the environment, and this one is
  // built from those declarations; `never` only lets deployments with different environments share a list.
  return deployment.library(bound as never);
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
  library: GatekeeperLibrary;
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
  const inner = await library.collector(rest).resolve(rest);
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
export function libraryCollector(config: SourceConfig, libraries: GatekeeperLibraries): NormalizedCollector {
  const { library, rest } = route(config, libraries);
  const inner = library.collector(rest);
  const normalize = inner.normalize;
  const withoutRoutingKey = (context: TransformContext): TransformContext => ({ ...context, feed: { ...context.feed, config: rest } });
  return {
    normalizer: inner.normalizer,
    resolve: (value) => resolveLibraryFeed(value, libraries),
    source: inner.source,
    normalize:
      normalize.kind === "streaming"
        ? { kind: "streaming", transform: (body, context) => normalize.transform(body, withoutRoutingKey(context)) }
        : { kind: "buffered", transform: (bytes, context) => normalize.transform(bytes, withoutRoutingKey(context)) },
  };
}
