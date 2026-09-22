import { allowedHosts, resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { OPENDATASOFT_FEEDS, OpendatasoftSource, validateOpendatasoftFeedConfig } from "./opendatasoft";
import { OpendatasoftTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface OpendatasoftCollectorOptions {
  config: SourceConfig;
  /** The hosts its publishers' feeds name, comma-separated: the only ones it may fetch. */
  hosts: string;
  fetcher: typeof fetch;
}

const transformer = new OpendatasoftTransformer();

/** Canonical feed resolution, shared by the Worker entrypoint and its collector. */
export async function resolveOpendatasoftFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  const resolved = await resolveFeed(config, { library: "opendatasoft", kinds: OPENDATASOFT_FEEDS, validate: (value) => validateOpendatasoftFeedConfig(value, hosts) });
  // The history walker filters one source field; compound year/month or year/quarter clocks cannot use it.
  if (config.monthField || config.quarterField) delete resolved.history;
  return resolved;
}

/** The collection wiring the Worker serves over RPC, kept outside the entrypoint so tests drive exactly it. */
export function opendatasoftCollector(options: OpendatasoftCollectorOptions): NormalizedCollector {
  const hosts = allowedHosts(options.hosts);
  const sourceFor = (signal?: AbortSignal): OpendatasoftSource => new OpendatasoftSource(hosts, (input, init) => options.fetcher(input, { ...init, signal: signal ?? null }));
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveOpendatasoftFeed(value, hosts),
    source: (state, mode, signal) =>
      mode.kind === "history" ? sourceFor(signal).collectHistory(options.config, mode.cursor) : sourceFor(signal).collect(options.config, sourceValidator(state)),
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
